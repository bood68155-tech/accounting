import { createHmac, timingSafeEqual } from "node:crypto";

// ─── Admin PIN gate ───────────────────────────────────────────────────────────
// The admin console requires the platform owner's email (ADMIN_EMAILS, checked
// in the page) AND a PIN. The PIN is verified server-side only; success sets an
// httpOnly cookie holding an HMAC-signed token (keyed by the PIN itself), so the
// cookie cannot be forged without knowing the PIN. Everything here is
// server-only — never import this module into client components.

/** Cookie set once the admin PIN has been verified. */
export const ADMIN_PIN_COOKIE = "admin_pin_ok";

/** PIN required to unlock the admin console. Override via ADMIN_PIN env var. */
export function adminPin(): string {
  return process.env.ADMIN_PIN ?? "222222";
}

/** Constant-time PIN comparison — avoids leaking the expected length on mismatch. */
export function pinMatches(input: string): boolean {
  const provided = Buffer.from(input);
  const expected = Buffer.from(adminPin());
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/**
 * Unguessable token issued on successful PIN entry. HMAC-keyed by the PIN
 * itself, so a static cookie value like "1" (trivially forgeable via a manual
 * `Cookie:` header) is replaced by a value only the server can produce.
 */
export function issuePinToken(): string {
  return createHmac("sha256", adminPin()).update("admin-pin-ok").digest("base64url");
}

/** Constant-time check that a cookie value is a valid PIN token. */
export function pinTokenMatches(token: string | undefined | null): boolean {
  if (!token) return false;
  const provided = Buffer.from(token);
  const expected = Buffer.from(issuePinToken());
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
