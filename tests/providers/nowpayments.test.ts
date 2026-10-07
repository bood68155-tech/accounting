import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";

/**
 * The crypto payment webhook is driven through its real interface — an HTTP POST
 * carrying a signed NOWPayments IPN payload — with the persistence layer mocked.
 * This verifies the wiring: that unsigned/tampered callbacks are rejected, that a
 * confirmed payment auto-approves exactly one pending payment, and that
 * non-terminal events are acknowledged without approving anything.
 */

const IPN_SECRET = "ipn-test-secret";

interface PendingRow {
  id: string;
  userId: string;
  txId: string;
  planCode: string | null;
  status: string;
}

let pendingRows: PendingRow[] = [];
let approveCalls: Array<Record<string, unknown>> = [];
let recordCalls: Array<Record<string, unknown>> = [];

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: () => true,
  requireDb: () => {
    throw new Error("requireDb should not be called when planCode is null");
  },
  publicSchema: {},
}));

vi.mock("@/lib/subscription/renewal", async () => {
  const actual = await vi.importActual<typeof import("@/lib/subscription/renewal")>(
    "@/lib/subscription/renewal",
  );
  return {
    ...actual,
    findPendingPaymentByTxId: vi.fn(async (txId: string) =>
      pendingRows.find((r) => r.txId === txId) ?? null,
    ),
    recordCryptoPendingPayment: vi.fn(async (input: Record<string, unknown>) => {
      recordCalls.push(input);
      pendingRows.push({
        id: "recovered",
        userId: String(input.userId),
        txId: String(input.orderId),
        planCode: (input.planCode as string | null) ?? null,
        status: "pending",
      });
      return { ok: true };
    }),
    approvePendingPayment: vi.fn(async (input: Record<string, unknown>) => {
      approveCalls.push(input);
      const row = pendingRows.find((r) => r.id === input.paymentId);
      const alreadyApproved = row?.status === "approved";
      if (row) row.status = "approved";
      return { ok: true, alreadyApproved, userId: "u1" };
    }),
  };
});

import { POST } from "@/app/api/webhooks/payments/route";

/** Recursively sort object keys — the canonicalization NOWPayments signs over. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortKeys(obj[k]);
        return acc;
      }, {});
  }
  return value;
}

function sign(body: unknown, secret = IPN_SECRET): string {
  return createHmac("sha512", secret)
    .update(JSON.stringify(sortKeys(body)), "utf8")
    .digest("hex");
}

function post(body: unknown, signature: string | null): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== null) headers["x-nowpayments-sig"] = signature;
  return POST(
    new NextRequest("http://test/api/webhooks/payments", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

const paidPayload = {
  payment_id: 987654,
  payment_status: "finished",
  order_id: "sub_11111111-1111-1111-1111-111111111111_1700000000000",
  price_amount: 30,
  price_currency: "usd",
  pay_amount: 30.01,
  pay_currency: "usdttrc20",
  actually_paid: 30.0,
  created_at: "2026-10-07T00:00:00Z",
  updated_at: "2026-10-07T00:05:00Z",
};

beforeEach(() => {
  process.env.CRYPTO_WEBHOOK_SECRET = IPN_SECRET;
  pendingRows = [
    {
      id: "p1",
      userId: "u1",
      txId: paidPayload.order_id,
      planCode: null,
      status: "pending",
    },
  ];
  approveCalls = [];
  recordCalls = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("NOWPayments webhook signature", () => {
  it("rejects a body without the signature header", async () => {
    const res = await post(paidPayload, null);
    expect(res.status).toBe(401);
    expect(approveCalls).toHaveLength(0);
  });

  it("rejects a tampered body", async () => {
    const res = await post({ ...paidPayload, price_amount: 0.01 }, sign(paidPayload));
    expect(res.status).toBe(401);
    expect(approveCalls).toHaveLength(0);
  });

  it("accepts a correctly signed body (key order independent)", async () => {
    const reordered = { price_amount: paidPayload.price_amount, payment_status: "finished", order_id: paidPayload.order_id, payment_id: paidPayload.payment_id, price_currency: paidPayload.price_currency, pay_amount: paidPayload.pay_amount, pay_currency: paidPayload.pay_currency, actually_paid: paidPayload.actually_paid, created_at: paidPayload.created_at, updated_at: paidPayload.updated_at };
    const res = await post(reordered, sign(reordered));
    expect(res.status).toBe(200);
    expect(approveCalls).toHaveLength(1);
  });
});

describe("NOWPayments webhook auto-approval", () => {
  it("auto-approves the matching pending payment on a finished payment", async () => {
    const res = await post(paidPayload, sign(paidPayload));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { approved: boolean; alreadyApproved: boolean };
    expect(json.approved).toBe(true);
    expect(approveCalls).toHaveLength(1);
    expect(approveCalls[0]).toMatchObject({ paymentId: "p1" });
    expect(String(approveCalls[0].reviewedBy)).toContain("crypto-gateway");
  });

  it("acknowledges non-terminal events without approving", async () => {
    const waiting = { ...paidPayload, payment_status: "waiting" };
    const res = await post(waiting, sign(waiting));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ignored: string };
    expect(json.ignored).toBe("waiting");
    expect(approveCalls).toHaveLength(0);
  });

  it("is idempotent on a redelivered confirmation", async () => {
    await post(paidPayload, sign(paidPayload));
    const res = await post(paidPayload, sign(paidPayload));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { alreadyApproved: boolean };
    expect(json.alreadyApproved).toBe(true);
  });

  it("recovers the owner from a sub_<userId> order id and approves", async () => {
    pendingRows = [];
    const res = await post(paidPayload, sign(paidPayload));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { approved: boolean };
    expect(json.approved).toBe(true);
    expect(recordCalls).toHaveLength(1);
    expect(recordCalls[0].userId).toBe("11111111-1111-1111-1111-111111111111");
    expect(approveCalls).toHaveLength(1);
  });

  it("acks an unmatched payment without approving", async () => {
    pendingRows = [];
    const orphan = { ...paidPayload, order_id: "external-order-999" };
    const res = await post(orphan, sign(orphan));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ignored: string };
    expect(json.ignored).toBe("unmatched_payment");
    expect(approveCalls).toHaveLength(0);
  });
});
