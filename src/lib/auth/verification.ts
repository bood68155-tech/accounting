import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * ── OTP verification tokens ──────────────────────────────────────────────────
 * A short-lived HMAC token proving "this email verified a 6-digit code for
 * this purpose". Issued by /api/auth/otp/verify; required by the signup route
 * and the credentials sign-in flow, so an account can only be created — or a
 * session only established — after the mailbox was actually proven.
 *
 * Format: base64url("email|purpose|expiryMs") + "." + HMAC-SHA256(AUTH_SECRET).
 */

const TOKEN_TTL_MS = 10 * 60_000;

function verificationSecret(): string {
  return process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "x-dev-otp-secret";
}

export type OtpTokenPurpose = "signup" | "login";

export function createVerifiedToken(email: string, purpose: OtpTokenPurpose): string {
  const expires = Date.now() + TOKEN_TTL_MS;
  const payload = `${email.toLowerCase()}|${purpose}|${expires}`;
  const sig = createHmac("sha256", verificationSecret()).update(payload).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

export function verifyVerifiedToken(token: string, email: string, purpose: OtpTokenPurpose): boolean {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payloadB64, sig] = parts;
  let payload: string;
  try {
    payload = Buffer.from(payloadB64, "base64url").toString("utf8");
  } catch {
    return false;
  }
  const [tokenEmail, tokenPurpose, expiresStr] = payload.split("|");
  const expires = Number.parseInt(expiresStr ?? "", 10);
  if (tokenEmail !== email.toLowerCase() || tokenPurpose !== purpose) return false;
  if (!Number.isFinite(expires) || expires <= Date.now()) return false;
  const expected = createHmac("sha256", verificationSecret()).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
