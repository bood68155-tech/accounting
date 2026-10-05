import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { getTenantTables, isTenantSchema, publicSchema, requireDb, tenantDb } from "@/lib/db";
import { isValidEmail, verifyOtp } from "@/lib/auth/otp";
import { normalizeTelegramPhone } from "@/lib/notifications/telegram";

/**
 * ── Telegram bot authentication ────────────────────────────────
 * The contact → email → app-password/PIN flow that verifies a
 * Telegram chat against an account in `public.users`.
 *
 * State lives in `public.telegram_sessions` because an inbound
 * Telegram webhook carries no session and no tenant context — the
 * row keyed by chat_id is the only memory the stateless webhook
 * has between steps.
 *
 * Every function returns its failure instead of throwing: the
 * webhook must answer Telegram with 2xx or the same doomed update
 * gets redelivered forever.
 */

/** Failed PIN attempts before the chat is locked out. */
export const AUTH_MAX_ATTEMPTS = 5;
/** How long a locked chat must wait before retrying. */
export const AUTH_LOCK_MINUTES = 15;

export type TelegramAuthState =
  | "awaiting_phone"
  | "awaiting_email"
  | "awaiting_pin"
  | "verified";

export interface TelegramSession {
  chatId: string;
  userId: string | null;
  phoneNumber: string | null;
  email: string | null;
  isVerified: boolean;
  verifiedAt: Date | null;
  state: TelegramAuthState;
  attempts: number;
  lockedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function rowToSession(row: typeof publicSchema.telegramSessions.$inferSelect): TelegramSession {
  return {
    chatId: row.chatId,
    userId: row.userId,
    phoneNumber: row.phoneNumber,
    email: row.email,
    isVerified: row.isVerified,
    verifiedAt: row.verifiedAt,
    state: row.state as TelegramAuthState,
    attempts: row.attempts,
    lockedUntil: row.lockedUntil,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Read a chat's auth session, or null when it has none yet. */
export async function getTelegramSession(chatId: string): Promise<TelegramSession | null> {
  const rows = await requireDb()
    .select()
    .from(publicSchema.telegramSessions)
    .where(eq(publicSchema.telegramSessions.chatId, chatId))
    .limit(1);
  return rows[0] ? rowToSession(rows[0]) : null;
}

/**
 * Create or update a chat's session.
 *
 * Partial patches are merged onto the existing row; the flow only
 * ever advances one step per webhook, so a lost update at worst
 * repeats a prompt.
 */
export async function upsertTelegramSession(
  chatId: string,
  patch: Partial<{
    userId: string | null;
    phoneNumber: string | null;
    email: string | null;
    isVerified: boolean;
    verifiedAt: Date | null;
    state: TelegramAuthState;
    attempts: number;
    lockedUntil: Date | null;
  }>,
): Promise<TelegramSession> {
  const now = new Date();
  const rows = await requireDb()
    .insert(publicSchema.telegramSessions)
    .values({ chatId, ...patch, updatedAt: now })
    .onConflictDoUpdate({
      target: publicSchema.telegramSessions.chatId,
      set: { ...patch, updatedAt: now },
    })
    .returning();
  if (!rows[0]) {
    // Defensive: the insert either persisted a row or threw.
    throw new Error("Could not persist the Telegram session.");
  }
  return rowToSession(rows[0]);
}

/** (Re)start the verification flow: fresh session, awaiting the phone. */
export async function startTelegramAuth(chatId: string): Promise<TelegramSession> {
  return upsertTelegramSession(chatId, {
    state: "awaiting_phone",
    phoneNumber: null,
    email: null,
    attempts: 0,
    lockedUntil: null,
    // isVerified/userId are left untouched: a re-started verified
    // session keeps its binding until it verifies again.
  });
}

/** Drop the flow's transient state (the /cancel command). */
export async function cancelTelegramAuth(chatId: string): Promise<void> {
  await upsertTelegramSession(chatId, {
    state: "awaiting_phone",
    phoneNumber: null,
    email: null,
    attempts: 0,
    lockedUntil: null,
  });
}

export interface TelegramVerifyResult {
  ok: boolean;
  /** Populated on failure — shown in the chat. */
  reason?: string;
  attemptsLeft?: number;
  /** Populated when the chat is locked out. */
  lockedUntil?: Date;
  /** Populated on success. */
  user?: { id: string; email: string; name: string | null };
}

export interface TelegramVerifyInput {
  chatId: string;
  /** Normalized (digits with leading +) phone from the contact share. */
  phoneNumber: string;
  email: string;
  /** App password or 6-digit verification PIN, as typed in chat. */
  secret: string;
}

/**
 * Step 4 of the flow: verify phone + email + app password/PIN
 * against `public.users`.
 *
 * The "PIN" is checked two ways, mirroring how the app itself
 * signs people in: a 6-digit input is a login OTP from
 * `public.otp_codes`, anything else is the account password
 * compared against its bcrypt hash. Google-only accounts have no
 * local password and must use an OTP.
 *
 * On success the session is marked verified, the phone+email →
 * chat mapping is stored, and `public.users` mirrors the latest
 * verified chat id.
 */
export async function verifyTelegramCredentials(
  input: TelegramVerifyInput,
): Promise<TelegramVerifyResult> {
  const email = input.email.trim().toLowerCase();
  if (!isValidEmail(email)) {
    return { ok: false, reason: "That doesn't look like an email address. Send /start to try again." };
  }

  const session = await getTelegramSession(input.chatId);
  if (!session || session.state !== "awaiting_pin") {
    return { ok: false, reason: "Let's start over — send /start." };
  }
  if (session.lockedUntil && session.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.ceil(
      (session.lockedUntil.getTime() - Date.now()) / 60_000,
    );
    return {
      ok: false,
      reason: `Too many failed attempts. Send /start again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      lockedUntil: session.lockedUntil,
    };
  }

  const db = requireDb();
  const { users, profiles } = publicSchema;

  const accountRows = await db
    .select({
      id: users.id,
      email: users.email,
      passwordHash: users.passwordHash,
      disabled: users.disabled,
      phoneNumber: users.phoneNumber,
      fullName: profiles.fullName,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.id, users.id))
    .where(eq(users.email, email))
    .limit(1);

  const account = accountRows[0];
  const fail = async (
    reason: string,
  ): Promise<TelegramVerifyResult> => {
    const attempts = session.attempts + 1;
    const locked = attempts >= AUTH_MAX_ATTEMPTS;
    await upsertTelegramSession(input.chatId, {
      attempts,
      lockedUntil: locked ? new Date(Date.now() + AUTH_LOCK_MINUTES * 60_000) : null,
    });
    return {
      ok: false,
      reason: locked
        ? `Too many failed attempts. Send /start again in ${AUTH_LOCK_MINUTES} minutes.`
        : `${reason} ${AUTH_MAX_ATTEMPTS - attempts} attempt${AUTH_MAX_ATTEMPTS - attempts === 1 ? "" : "s"} left.`,
      attemptsLeft: AUTH_MAX_ATTEMPTS - attempts,
    };
  };

  if (!account || account.disabled) {
    return fail("No matching account — check the email and phone you shared.");
  }
  // A phone already on the account must match the one just shared,
  // so knowing an email alone is not enough to bind a chat.
  if (
    account.phoneNumber &&
    normalizeTelegramPhone(account.phoneNumber) !== input.phoneNumber
  ) {
    return fail("That phone number doesn't match the account on file.");
  }

  const secret = input.secret.trim();
  let matched: boolean;
  if (/^\d{6}$/.test(secret)) {
    // 6-digit input: a login OTP (single use, 10-minute expiry).
    matched = (await verifyOtp(email, "login", secret)).ok;
  } else {
    // Anything else: the account password / app password.
    matched = account.passwordHash
      ? await bcrypt.compare(secret, account.passwordHash)
      : false;
  }
  if (!matched) {
    return fail(
      account.passwordHash
        ? "Wrong app password or PIN."
        : "This account signs in with Google — request a 6-digit verification code and send that instead.",
    );
  }

  // Verified: record the mapping and mirror it onto the user row.
  const now = new Date();
  await upsertTelegramSession(input.chatId, {
    state: "verified",
    isVerified: true,
    verifiedAt: now,
    userId: account.id,
    phoneNumber: input.phoneNumber,
    email,
    attempts: 0,
    lockedUntil: null,
  });

  await db
    .update(users)
    .set({ telegramChatId: input.chatId, phoneNumber: input.phoneNumber })
    .where(eq(users.id, account.id));

  return {
    ok: true,
    user: { id: account.id, email: account.email, name: account.fullName ?? null },
  };
}

/** A store the user owns, with the tenant schema needed to read it. */
export interface TelegramUserStore {
  tenantId: string;
  tenantName: string;
  schemaName: string;
  storeId: string;
  storeName: string;
  currency: string;
}

/**
 * Every store a user owns, across their tenants.
 *
 * The public tables resolve user → tenant schemas; each tenant's
 * stores are then read through `tenantDb(schema)` — tenant data is
 * never queried through the public client.
 */
export async function fetchTelegramUserStores(
  userId: string,
): Promise<TelegramUserStore[]> {
  const db = requireDb();
  const { tenants, tenantUsers } = publicSchema;

  const tenantRows = await db
    .select({
      tenantId: tenants.id,
      tenantName: tenants.name,
      schemaName: tenants.schemaName,
    })
    .from(tenantUsers)
    .innerJoin(tenants, eq(tenants.id, tenantUsers.tenantId))
    .where(eq(tenantUsers.userId, userId));

  const stores: TelegramUserStore[] = [];
  for (const tenant of tenantRows) {
    if (!isTenantSchema(tenant.schemaName)) continue;
    try {
      const t = getTenantTables(tenant.schemaName);
      const rows = await tenantDb(tenant.schemaName)
        .select({ id: t.stores.id, name: t.stores.name, currency: t.stores.currency })
        .from(t.stores)
        .where(eq(t.stores.userId, userId));
      for (const store of rows) {
        stores.push({
          tenantId: tenant.tenantId,
          tenantName: tenant.tenantName,
          schemaName: tenant.schemaName,
          storeId: store.id,
          storeName: store.name,
          currency: store.currency,
        });
      }
    } catch {
      // A tenant provisioned before the digest migration has no
      // stores table to read — skip it rather than fail the menu.
    }
  }
  return stores;
}

/** Human label for a chat in confirmation messages. */
export function sessionLabel(session: TelegramSession): string {
  return session.email ?? session.phoneNumber ?? "your account";
}
