import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { verifyTelegramCredentials } from "@/lib/data/telegramAuth";
import { verifyOtp } from "@/lib/auth/otp";

/**
 * Unit tests for the Step 3 password verification in `telegramAuth.ts`.
 *
 * The Drizzle/Neon layer is faked so tests run without DATABASE_URL. The
 * regression under test: an account whose real password is six digits (e.g.
 * "123123") must be verified against its bcrypt hash, NOT mistaken for a login
 * OTP. The OTP path stays as a fallback for inputs that are not the password.
 */

interface Account {
  id: string;
  email: string;
  passwordHash: string | null;
  disabled: boolean;
  phoneNumber: string | null;
  fullName: string | null;
}

const h = vi.hoisted(() => ({
  /** Row returned by `getTelegramSession`. */
  session: null as Record<string, unknown> | null,
  /** Row returned by the `public.users` account lookup. */
  account: null as Record<string, unknown> | null,
  /** Values passed to `upsertTelegramSession`. */
  upserts: [] as Array<Record<string, unknown>>,
  /** Result the mocked `verifyOtp` resolves with. */
  otp: { ok: false },
}));

vi.mock("@/lib/auth/otp", () => ({
  isValidEmail: (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
  verifyOtp: vi.fn(async () => h.otp),
}));

vi.mock("@/lib/db", () => {
  const publicSchema = {
    telegramSessions: {
      chatId: "chat_id",
      userId: "user_id",
      phoneNumber: "phone_number",
      email: "email",
      isVerified: "is_verified",
      verifiedAt: "verified_at",
      state: "state",
      attempts: "attempts",
      lockedUntil: "locked_until",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
    users: {
      id: "id",
      email: "email",
      passwordHash: "password_hash",
      disabled: "disabled",
      phoneNumber: "phone_number",
      telegramChatId: "telegram_chat_id",
    },
    profiles: { id: "id", fullName: "full_name" },
  };

  const selectFrom = (table: unknown) => {
    const rows = table === publicSchema.telegramSessions
      ? h.session
        ? [h.session]
        : []
      : h.account
        ? [h.account]
        : [];
    const resolve = () => Promise.resolve(rows);
    return {
      where: () => ({ limit: resolve }),
      leftJoin: () => ({ where: () => ({ limit: resolve }) }),
    };
  };

  const requireDb = () => ({
    select: () => ({ from: selectFrom }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        h.upserts.push(values);
        const row = { createdAt: new Date(), updatedAt: new Date(), ...values };
        return {
          onConflictDoUpdate: () => ({ returning: () => Promise.resolve([row]) }),
        };
      },
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
  });

  return {
    publicSchema,
    requireDb,
    getTenantTables: () => ({}),
    isTenantSchema: () => false,
    tenantDb: () => ({}),
  };
});

const awaitingPinSession = (): Record<string, unknown> => ({
  chatId: "555",
  userId: null,
  phoneNumber: "+966500000000",
  email: "user@example.com",
  isVerified: false,
  verifiedAt: null,
  state: "awaiting_pin",
  attempts: 0,
  lockedUntil: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const account = (over: Partial<Account> = {}): Record<string, unknown> => ({
  id: "u1",
  email: "user@example.com",
  passwordHash: null,
  disabled: false,
  phoneNumber: null,
  fullName: "Ada",
  ...over,
});

const verify = (secret: string) =>
  verifyTelegramCredentials({
    chatId: "555",
    phoneNumber: "+966500000000",
    email: "user@example.com",
    secret,
  });

beforeEach(() => {
  h.session = awaitingPinSession();
  h.account = account();
  h.upserts = [];
  h.otp = { ok: false };
  vi.clearAllMocks();
});

describe("verifyTelegramCredentials — Step 3 password", () => {
  it("verifies a 6-digit password against the bcrypt hash instead of treating it as an OTP", async () => {
    h.account = account({ passwordHash: bcrypt.hashSync("123123", 10) });

    const result = await verify("123123");

    expect(result.ok).toBe(true);
    expect(result.user).toEqual({ id: "u1", email: "user@example.com", name: "Ada" });
    // The password matched, so no OTP lookup was even attempted.
    expect(verifyOtp).not.toHaveBeenCalled();
    // The session is marked verified and bound to the user.
    expect(h.upserts.at(-1)).toEqual(
      expect.objectContaining({ state: "verified", isVerified: true, userId: "u1" }),
    );
  });

  it("falls back to a 6-digit login OTP when the input is not the password", async () => {
    h.account = account({ passwordHash: bcrypt.hashSync("999999", 10) });
    h.otp = { ok: true };

    const result = await verify("123456");

    expect(result.ok).toBe(true);
    expect(verifyOtp).toHaveBeenCalledWith("user@example.com", "login", "123456");
  });

  it("lets a Google-only account (no local password) link with an OTP", async () => {
    h.account = account({ passwordHash: null });
    h.otp = { ok: true };

    const result = await verify("654321");

    expect(result.ok).toBe(true);
    expect(verifyOtp).toHaveBeenCalledWith("user@example.com", "login", "654321");
  });

  it("fails a wrong 6-digit input and burns an attempt without verifying", async () => {
    h.account = account({ passwordHash: bcrypt.hashSync("123123", 10) });

    const result = await verify("000000");

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Wrong app password or PIN.");
    expect(result.attemptsLeft).toBe(4);
    expect(h.upserts.at(-1)).toEqual(expect.objectContaining({ attempts: 1 }));
  });

  it("never routes a non-6-digit input through the OTP verifier", async () => {
    h.account = account({ passwordHash: bcrypt.hashSync("correct-horse", 10) });

    const result = await verify("wrong-password");

    expect(result.ok).toBe(false);
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});
