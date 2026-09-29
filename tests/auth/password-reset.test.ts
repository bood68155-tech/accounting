import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetOtpIssue, resetOtpConsume, OTP_TTL_MINUTES } from "@/lib/auth/otp";
import { resendSandboxErrorMessage } from "@/lib/auth/resend";

/**
 * Unit tests for the forgot-password flow's OTP helpers: resetOtpIssue (only
 * known accounts, "password_reset" purpose, 10-minute TTL) and
 * resetOtpConsume (verify + delete in one step — single use). The Drizzle/Neon
 * layer is faked so tests run without DATABASE_URL; otp_codes is built with a
 * REAL drizzle pgTable so eq(otpCodes.id, …) predicates carry a Param the fake
 * can read.
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
      /** Whether isEmailUsed's users-table lookup finds the account. */
      userExists: true,
      /** Select result returned by the mocked otp_codes query chain. */
      selectResult: [] as Array<Record<string, unknown>>,
      /** Row ids removed via db.delete(otpCodes)…eq(id). */
      deletedIds: [] as string[],
    },
  };
});

/**
 * Pull candidate row ids out of a real Drizzle eq(otpCodes.id, …) predicate.
 * eq() builds an SQL node whose queryChunks contain a Param carrying the
 * bound value — that Param's value is the id.
 */
function stringsFromPredicate(predicate: unknown): string[] {
  const chunks = (predicate as { queryChunks?: Array<unknown> } | undefined)?.queryChunks;
  if (!Array.isArray(chunks)) return [];
  const out: string[] = [];
  for (const chunk of chunks) {
    const value = (chunk as { value?: unknown } | null)?.value;
    if (typeof value === "string" && value.length > 0) out.push(value);
  }
  return out;
}

vi.mock("@/lib/db", async () => {
  const { pgTable, text, integer, boolean, timestamp, uuid } = await import("drizzle-orm/pg-core");

  // A real Drizzle table keeps eq(otpCodes.id, rowId) predicates inspectable.
  const otpCodes = pgTable("otp_codes", {
    id: uuid("id"),
    email: text("email"),
    codeHash: text("code_hash"),
    purpose: text("purpose"),
    attempts: integer("attempts"),
    consumed: boolean("consumed"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }),
  });

  return {
    isDatabaseConfigured: () => true,
    publicSchema: {
      otpCodes,
      // Marker value lets the fake distinguish the users table from otp_codes.
      users: { email: "users_email_marker", id: "id" },
    },
    requireDb: () => ({
      select: () => ({
        from: (table: { email: unknown }) => {
          const isUsersTable = table?.email === "users_email_marker";
          return {
            where: () => ({
              // otp_codes chain: .where().orderBy().limit()
              orderBy: () => ({
                limit: () => Promise.resolve(h.state.selectResult),
              }),
              // users chain (isEmailUsed): .where().limit()
              limit: () =>
                Promise.resolve(isUsersTable && h.state.userExists ? [{ id: "u1" }] : []),
            }),
          };
        },
      }),      insert: () => ({
      values: (vals: Record<string, unknown>) => {
        const id = `otp_${h.state.rows.length + 1}`;
        h.state.rows.push({
          id,
          email: String(vals.email),
          codeHash: String(vals.codeHash),
          purpose: String(vals.purpose),
          attempts: 0,
          consumed: false,
          expiresAt: vals.expiresAt as Date,
          createdAt: new Date(),
        });
        // Upstream issueOtp requires a persisted row before responding
        // (persist-before-respond), so .returning() must yield the row.
        return { returning: () => Promise.resolve([{ id }]) };
      },
    }),
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: () => {
            const target = h.state.selectResult[0] ?? newestRow();
            if (target) Object.assign(target, patch);
            return Promise.resolve([]);
          },
        }),
      }),
      delete: () => ({
        where: (predicate: unknown) => {
          // eq(otpCodes.id, rowId) → record which row was deleted.
          h.state.deletedIds.push(...stringsFromPredicate(predicate).filter((s) => s.startsWith("otp_")));
          // Deletion clears the "newest active code" view, like the real DB.
          h.state.selectResult = [];
          return Promise.resolve([]);
        },
      }),
    }),
  };
});

function newestRow() {
  return h.state.rows[h.state.rows.length - 1];
}

beforeEach(() => {
  h.state.rows = [];
  h.state.userExists = true;
  h.state.selectResult = [];
  h.state.deletedIds = [];
  process.env.AUTH_SECRET = "test-secret";
  delete process.env.SMTP_URL;
  delete process.env.GMAIL_USER;
  delete process.env.GMAIL_APP_PASSWORD;
  delete process.env.RESEND_API_KEY;
  delete process.env.OTP_DEV_MASTER_CODE;
  delete process.env.OTP_ALLOW_INSECURE_MASTER_CODE;
});

describe("resendSandboxErrorMessage", () => {
  it("detects Resend testing-sandbox rejections and explains the restriction", () => {
    const raw = "Resend: You can only send testing emails to your own email address (user@x.com).";
    const msg = resendSandboxErrorMessage(raw);
    expect(msg).toMatch(/testing sandbox/i);
    expect(msg).toMatch(/resend\.com\/domains/i);
    expect(msg).not.toBe(raw);
  });

  it("detects the verify-your-domain variant", () => {
    const msg = resendSandboxErrorMessage("Resend: Please verify a domain before sending to this address.");
    expect(msg).toMatch(/testing sandbox/i);
  });

  it("passes unrelated errors through unchanged", () => {
    const raw = "Resend: invalid from address";
    expect(resendSandboxErrorMessage(raw)).toBe(raw);
  });
});

describe("resetOtpIssue", () => {
  it("issues a password_reset code for an existing account with the 10-minute TTL", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const result = await resetOtpIssue("Owner@Shop.com");
      expect(result.ok).toBe(true);

      const row = newestRow();
      expect(row.email).toBe("owner@shop.com");
      expect(row.purpose).toBe("password_reset");
      const ttlMs = row.expiresAt.getTime() - Date.now();
      expect(ttlMs).toBeGreaterThan((OTP_TTL_MINUTES - 1) * 60_000);
      expect(ttlMs).toBeLessThanOrEqual(OTP_TTL_MINUTES * 60_000);
    } finally {
      consoleInfo.mockRestore();
    }
  });

  it("does NOT issue a code for an unknown email", async () => {
    h.state.userExists = false;
    const result = await resetOtpIssue("ghost@shop.com");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no account found/i);
    expect(h.state.rows).toHaveLength(0);
  });

  it("rate limits via the shared issueOtp path (3 codes / 15 minutes)", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      h.state.selectResult = [0, 1, 2].map((i) => ({ createdAt: new Date(Date.now() - i * 60_000) }));
      const result = await resetOtpIssue("owner@shop.com");
      expect(result.ok).toBe(false);
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
      expect(h.state.rows).toHaveLength(0);
    } finally {
      consoleInfo.mockRestore();
    }
  });
});

describe("resetOtpConsume", () => {
  async function issueFor(email: string) {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const result = await resetOtpIssue(email);
    consoleInfo.mockRestore();
    if (!result.ok || !result.devCode) throw new Error("expected dev code");
    h.state.selectResult = [newestRow()];
    return result.devCode;
  }

  it("verifies a correct code and DELETES the row (single use)", async () => {
    const code = await issueFor("owner@shop.com");
    const row = newestRow();

    const ok = await resetOtpConsume("owner@shop.com", code);
    expect(ok.ok).toBe(true);
    expect(h.state.deletedIds).toContain(row.id);
  });

  it("rejects a replayed code — the row was deleted", async () => {
    const code = await issueFor("owner@shop.com");
    await resetOtpConsume("owner@shop.com", code);

    // The delete cleared the active-code view: a replay finds nothing.
    const replay = await resetOtpConsume("owner@shop.com", code);
    expect(replay.ok).toBe(false);
    expect(replay.error).toMatch(/no active code/i);
  });

  it("rejects wrong codes without deleting the row", async () => {
    const code = await issueFor("owner@shop.com");
    const row = newestRow();

    const wrong = await resetOtpConsume("owner@shop.com", code === "000000" ? "111111" : "000000");
    expect(wrong.ok).toBe(false);
    expect(wrong.error).toMatch(/incorrect code/i);
    expect(h.state.deletedIds).not.toContain(row.id);
  });

  it("rejects expired codes and cleans the row up", async () => {
    const code = await issueFor("owner@shop.com");
    const row = newestRow();
    row.expiresAt = new Date(Date.now() - 1);

    const result = await resetOtpConsume("owner@shop.com", code);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/expired/i);
    expect(h.state.deletedIds).toContain(row.id);
  });

  it("rejects malformed codes", async () => {
    await issueFor("owner@shop.com");
    const malformed = await resetOtpConsume("owner@shop.com", "12ab56");
    expect(malformed.ok).toBe(false);
    expect(malformed.error).toMatch(/6-digit/i);
  });

  it("master-code bypass verifies without a DB row", async () => {
    process.env.OTP_DEV_MASTER_CODE = "123456";
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      h.state.selectResult = [];
      const result = await resetOtpConsume("ghost@shop.com", "123456");
      expect(result.ok).toBe(true);
    } finally {
      consoleInfo.mockRestore();
    }
  });
});
