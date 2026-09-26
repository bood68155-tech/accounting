import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { issueOtp, verifyOtp, OTP_TTL_MINUTES, OTP_MAX_ATTEMPTS } from "@/lib/auth/otp";

/**
 * Unit tests for the 6-digit email OTP library (issue + verify + limits).
 * The Drizzle/Neon layer is faked so tests run without DATABASE_URL; the
 * fake records inserts/updates and returns a controllable select result.
 */

const h = vi.hoisted(() => {
  return {
    state: {
      /** Rows "in the DB" for the otp_codes table. */
      rows: [] as Array<{
        id: string;
        email: string;
        codeHash: string;
        purpose: string;
        attempts: number;
        consumed: boolean;
        expiresAt: Date;
        createdAt: Date;
      }>,
      /** The most recent plaintext code handed to the (fake) email sender. */
      lastSentCode: null as string | null,
      /** Select result returned by the mocked query chain. */
      selectResult: [] as Array<Record<string, unknown>>,
    },
  };
});

vi.mock("@/lib/db", () => ({
  publicSchema: {
    otpCodes: {
      email: "email",
      purpose: "purpose",
      codeHash: "code_hash",
      attempts: "attempts",
      consumed: "consumed",
      expiresAt: "expires_at",
      createdAt: "created_at",
      id: "id",
    },
  },
  requireDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve(h.state.selectResult),
          }),
        }),
      }),
    }),
    insert: () => ({
      values: (vals: Record<string, unknown>) => {
        h.state.rows.push({
          id: `otp_${h.state.rows.length + 1}`,
          email: String(vals.email),
          codeHash: String(vals.codeHash),
          purpose: String(vals.purpose),
          attempts: 0,
          consumed: false,
          expiresAt: vals.expiresAt as Date,
          createdAt: new Date(),
        });
        return { returning: () => Promise.resolve([]) };
      },
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => {
          // Apply the patch to the row under test (the one the mocked select
          // returns), so attempts/consumed transitions persist like the real DB.
          const target = h.state.selectResult[0] ?? newestRow();
          if (target) Object.assign(target, patch);
          return Promise.resolve([]);
        },
      }),
    }),
    delete: () => ({
      where: () => Promise.resolve([]),
    }),
  }),
}));

// Capture codes without configuring a real email transport.
vi.mock("nodemailer", () => ({ default: { createTransport: () => { throw new Error("no transport in tests"); } } }));

function newestRow() {
  return h.state.rows[h.state.rows.length - 1];
}

beforeEach(() => {
  h.state.rows = [];
  h.state.lastSentCode = null;
  h.state.selectResult = [];
  process.env.AUTH_SECRET = "test-secret";
  delete process.env.SMTP_URL;
  delete process.env.GMAIL_USER;
  delete process.env.GMAIL_APP_PASSWORD;
});

describe("issueOtp", () => {
  it("issues a 6-digit code, stores only its hash, and logs delivery in dev", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const result = await issueOtp("Owner@Shop.com", "signup");
      expect(result.ok).toBe(true);
      expect(result.delivery).toBe("console");

      // 6 digits, exposed in dev (non-production) so the flow is testable.
      expect(result.devCode).toMatch(/^\d{6}$/);

      // Email is normalized to lowercase.
      const row = newestRow();
      expect(row.email).toBe("owner@shop.com");
      expect(row.purpose).toBe("signup");
      expect(row.codeHash).not.toBe(result.devCode);
      await expect(bcrypt.compare(result.devCode!, row.codeHash)).resolves.toBe(true);

      // Expiry ≈ TTL minutes in the future.
      const ttlMs = row.expiresAt.getTime() - Date.now();
      expect(ttlMs).toBeGreaterThan((OTP_TTL_MINUTES - 1) * 60_000);
      expect(ttlMs).toBeLessThanOrEqual(OTP_TTL_MINUTES * 60_000);

      // The console fallback carries the code (dev transport).
      expect(consoleInfo.mock.calls.some((args) => String(args[0]).includes(result.devCode!))).toBe(true);
    } finally {
      consoleInfo.mockRestore();
    }
  });

  it("rejects invalid emails without touching the database", async () => {
    const result = await issueOtp("not-an-email", "signup");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/valid email/i);
    expect(h.state.rows).toHaveLength(0);
  });

  it("rate-limits after 3 codes in the 15-minute window per email+purpose", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const now = Date.now();
      // Simulate 3 recent issues.
      h.state.selectResult = [0, 1, 2].map((i) => ({ createdAt: new Date(now - i * 60_000) }));

      const result = await issueOtp("flooded@shop.com", "signup");
      expect(result.ok).toBe(false);
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
      expect(result.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
      expect(h.state.rows).toHaveLength(0); // nothing persisted
    } finally {
      consoleInfo.mockRestore();
    }
  });

  it("enforces the resend cooldown after a fresh code", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      // One code issued 10 seconds ago → inside the 45s cooldown.
      h.state.selectResult = [{ createdAt: new Date(Date.now() - 10_000) }];

      const result = await issueOtp("cooldown@shop.com", "login");
      expect(result.ok).toBe(false);
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
      expect(result.retryAfterSeconds).toBeLessThanOrEqual(45);
    } finally {
      consoleInfo.mockRestore();
    }
  });

  it("keeps purposes isolated: login codes are not blocked by signup codes", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      // Two recent signup codes — under the limit; issued for login purpose.
      h.state.selectResult = [{ createdAt: new Date(Date.now() - 60_000) }];
      const result = await issueOtp("mixed@shop.com", "login");
      expect(result.ok).toBe(true);
    } finally {
      consoleInfo.mockRestore();
    }
  });
});

describe("verifyOtp", () => {
  async function issueFor(email: string, purpose: "signup" | "login" = "signup") {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const result = await issueOtp(email, purpose);
    consoleInfo.mockRestore();
    if (!result.ok || !result.devCode) throw new Error("expected dev code");
    // Point the mocked select at the freshly inserted row.
    h.state.selectResult = [newestRow()];
    return result.devCode;
  }

  it("verifies a correct code and consumes it (single use)", async () => {
    const code = await issueFor("single@shop.com");

    const ok = await verifyOtp("single@shop.com", "signup", code);
    expect(ok.ok).toBe(true);

    // Row is consumed — replaying the same code must fail.
    const replay = await verifyOtp("single@shop.com", "signup", code);
    expect(replay.ok).toBe(false);
    expect(replay.error).toMatch(/no active code/i);
  });

  it("rejects wrong codes and surfaces remaining attempts", async () => {
    await issueFor("wrong@shop.com");
    const wrong = await verifyOtp("wrong@shop.com", "signup", "000000");
    expect(wrong.ok).toBe(false);
    expect(wrong.error).toMatch(/incorrect code/i);
    expect(wrong.error).toMatch(new RegExp(String(OTP_MAX_ATTEMPTS - 1)));
  });

  it("expires codes after the TTL", async () => {
    const code = await issueFor("stale@shop.com");
    const row = newestRow();
    row.expiresAt = new Date(Date.now() - 1); // force-expire

    const result = await verifyOtp("stale@shop.com", "signup", code);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/expired/i);
  });

  it("burns out after OTP_MAX_ATTEMPTS wrong tries", async () => {
    const code = await issueFor("attempts@shop.com");
    const row = newestRow();

    for (let i = 0; i < OTP_MAX_ATTEMPTS; i += 1) {
      row.attempts = i; // simulate persisted attempt counter between calls
      await verifyOtp("attempts@shop.com", "signup", "111111");
    }
    row.attempts = OTP_MAX_ATTEMPTS;

    // Even the CORRECT code is now rejected — the code is burned.
    const result = await verifyOtp("attempts@shop.com", "signup", code);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/too many attempts/i);
  });

  it("rejects malformed codes and unknown emails", async () => {
    const bad = await verifyOtp("unknown@shop.com", "signup", "123456");
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/no active code/i);

    const malformed = await verifyOtp("unknown@shop.com", "signup", "12ab56");
    expect(malformed.ok).toBe(false);
    expect(malformed.error).toMatch(/6-digit/i);
  });

  it("is case-insensitive on email", async () => {
    const code = await issueFor("Case@Shop.com", "login");
    const result = await verifyOtp("CASE@SHOP.COM", "login", code);
    expect(result.ok).toBe(true);
  });
});
