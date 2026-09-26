import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, desc, eq, lt } from "drizzle-orm";
import { requireDb, publicSchema } from "@/lib/db";

/**
 * ── Email OTP (6-digit one-time passcodes) ────────────────────────────────────
 * Issues and verifies 6-digit email codes for account registration and
 * sign-in verification. Design properties:
 *
 *   • Codes are 6 digits, issued with crypto.randomInt (CSPRNG).
 *   • Stored as bcrypt hashes — plaintext exists only inside the email.
 *   • 10-minute expiry, max 5 verification attempts, single use.
 *   • Per-email rate limit: 3 codes / 15 minutes (prevents email bombing).
 *   • Delivery: SMTP via nodemailer (SMTP_URL env) or Gmail app-password
 *     (GMAIL_USER + GMAIL_APP_PASSWORD). Without transport config, codes are
 *     logged to the server console in dev so the flow stays testable.
 */

export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
const OTP_RATE_LIMIT = { count: 3, windowMinutes: 15 };
const OTP_RESEND_COOLDOWN_SECONDS = 45;

export type OtpPurpose = "signup" | "login";

export interface IssueOtpResult {
  ok: boolean;
  error?: string;
  /** Seconds until another code may be requested (rate limit cooldown). */
  retryAfterSeconds?: number;
  /** Dev-only: the code when no email transport is configured. */
  devCode?: string;
  /** How the code was delivered (for UI messaging). */
  delivery: "email" | "console";
}

export interface VerifyOtpResult {
  ok: boolean;
  error?: string;
  /** Seconds until another code may be requested after a failure. */
  retryAfterSeconds?: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

/** True when an SMTP transport is configured (otherwise codes log to console). */
export function isEmailTransportConfigured(): boolean {
  return Boolean(
    (process.env.SMTP_URL && process.env.SMTP_FROM) ||
      (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD),
  );
}

/**
 * Issue (create + send) a 6-digit OTP for an email/purpose pair.
 * Any failure is returned, never thrown — API routes map it to a response.
 */
export async function issueOtp(rawEmail: string, purpose: OtpPurpose): Promise<IssueOtpResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!isValidEmail(email)) {
    return { ok: false, error: "Enter a valid email address.", delivery: "console" };
  }

  const db = requireDb();
  const { otpCodes } = publicSchema;
  const now = new Date();

  // Rate limit: OTP_RATE_LIMIT codes per window per email.
  const since = new Date(now.getTime() - OTP_RATE_LIMIT.windowMinutes * 60_000);
  const recent = await db
    .select({ createdAt: otpCodes.createdAt })
    .from(otpCodes)
    .where(and(eq(otpCodes.email, email), eq(otpCodes.purpose, purpose)))
    .orderBy(desc(otpCodes.createdAt))
    .limit(OTP_RATE_LIMIT.count + 2);

  const inWindow = recent.filter((r) => r.createdAt >= since);
  if (inWindow.length >= OTP_RATE_LIMIT.count) {
    const newest = inWindow[0].createdAt;
    const elapsedSec = Math.floor((now.getTime() - newest.getTime()) / 1000);
    const windowSec = OTP_RATE_LIMIT.windowMinutes * 60;
    const retryAfterSeconds = Math.max(1, Math.min(windowSec, windowSec - elapsedSec));
    return {
      ok: false,
      error: `Too many codes requested. Try again in ${Math.ceil(retryAfterSeconds / 60)} minute${Math.ceil(retryAfterSeconds / 60) === 1 ? "" : "s"}.`,
      retryAfterSeconds,
      delivery: "console",
    };
  }

  // Resend cooldown: the newest code must be OTP_RESEND_COOLDOWN_SECONDS old.
  if (recent.length > 0 && recent[0].createdAt >= new Date(now.getTime() - OTP_RESEND_COOLDOWN_SECONDS * 1000)) {
    const elapsed = Math.floor((now.getTime() - recent[0].createdAt.getTime()) / 1000);
    const retryAfterSeconds = Math.max(1, OTP_RESEND_COOLDOWN_SECONDS - elapsed);
    return {
      ok: false,
      error: `Please wait ${retryAfterSeconds}s before requesting another code.`,
      retryAfterSeconds,
      delivery: "console",
    };
  }

  // Generate + hash.
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(now.getTime() + OTP_TTL_MINUTES * 60_000);

  await db.insert(otpCodes).values({ email, codeHash, purpose, expiresAt });

  // Housekeeping: drop stale codes opportunistically.
  await db.delete(otpCodes).where(lt(otpCodes.expiresAt, new Date(now.getTime() - 24 * 60 * 60_000)));

  const sent = await sendOtpEmail(email, code, purpose);
  if (!sent.ok) {
    return { ok: false, error: sent.error, delivery: "console" };
  }

  return {
    ok: true,
    delivery: sent.via,
    // Expose the code ONLY in non-production with no transport configured,
    // so the flow is testable locally without an email inbox.
    devCode: process.env.NODE_ENV === "production" ? undefined : code,
  };
}

/**
 * Verify a submitted code. On success the code is consumed (single use).
 * Failed attempts increment the counter; exceeding OTP_MAX_ATTEMPTS burns
 * the code and forces a fresh request.
 */
export async function verifyOtp(
  rawEmail: string,
  purpose: OtpPurpose,
  rawCode: string,
): Promise<VerifyOtpResult> {
  const email = rawEmail.trim().toLowerCase();
  const code = rawCode.trim();

  if (!isValidEmail(email)) return { ok: false, error: "Enter a valid email address." };
  if (!/^\d{6}$/.test(code)) return { ok: false, error: "Enter the 6-digit code from your email." };

  const db = requireDb();
  const { otpCodes } = publicSchema;

  const rows = await db
    .select()
    .from(otpCodes)
    .where(and(eq(otpCodes.email, email), eq(otpCodes.purpose, purpose)))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);

  const row = rows[0];
  if (!row || row.consumed) {
    return { ok: false, error: "No active code — request a new one." };
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    return { ok: false, error: "This code has expired — request a new one." };
  }
  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, error: "Too many attempts — request a new code." };
  }

  const matched = await bcrypt.compare(code, row.codeHash);
  if (!matched) {
    const attempts = row.attempts + 1;
    await db.update(otpCodes).set({ attempts }).where(eq(otpCodes.id, row.id));
    const left = OTP_MAX_ATTEMPTS - attempts;
    return {
      ok: false,
      error:
        left > 0
          ? `Incorrect code — ${left} attempt${left === 1 ? "" : "s"} left.`
          : "Too many attempts — request a new code.",
    };
  }

  await db.update(otpCodes).set({ consumed: true }).where(eq(otpCodes.id, row.id));
  return { ok: true };
}

// ── Email delivery ───────────────────────────────────────────────────────────

function template(email: string, code: string, purpose: OtpPurpose): { subject: string; text: string; html: string } {
  const action = purpose === "signup" ? "create your account" : "sign in";
  const minutes = OTP_TTL_MINUTES;
  return {
    subject: `Your X verification code: ${code}`,
    text: `Your verification code is ${code}. It expires in ${minutes} minutes. Enter this code to ${action}. If you didn't request this, you can ignore this email.`,
    html: `<!doctype html>
<html><body style="margin:0;padding:0;background:#0b0d10;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:32px 24px;">
    <div style="background:#111318;border:1px solid #27272a;border-radius:16px;padding:32px;">
      <p style="margin:0 0 8px;color:#a1a1aa;font-size:13px;">X — Automated AI Accounting</p>
      <h1 style="margin:0 0 16px;color:#fafafa;font-size:20px;">Verify your email</h1>
      <p style="margin:0 0 20px;color:#d4d4d8;font-size:14px;line-height:1.6;">
        Use this 6-digit code to ${action}:
      </p>
      <div style="background:#0b0d10;border:1px solid #27272a;border-radius:12px;padding:16px;text-align:center;margin:0 0 20px;">
        <span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#34d399;">${code}</span>
      </div>
      <p style="margin:0 0 8px;color:#71717a;font-size:12px;line-height:1.6;">
        This code expires in ${minutes} minutes and can be used once. If you didn't request it, you can safely ignore this email.
      </p>
    </div>
  </div>
</body></html>`,
  };
}

async function sendOtpEmail(
  email: string,
  code: string,
  purpose: OtpPurpose,
): Promise<{ ok: boolean; error?: string; via: "email" | "console" }> {
  const { subject, text, html } = template(email, code, purpose);

  const gmailUser = process.env.GMAIL_USER?.trim();
  const gmailPass = process.env.GMAIL_APP_PASSWORD?.trim();
  const smtpUrl = process.env.SMTP_URL?.trim();

  // Dev/test fallback: no transport → log to the server console.
  if (!smtpUrl && !(gmailUser && gmailPass)) {
    console.info(`[otp] EMAIL TRANSPORT NOT CONFIGURED — code for ${email} (${purpose}): ${code}`);
    return { ok: true, via: "console" };
  }

  const via: "email" | "console" = "email";
  try {
    // nodemailer is an optional dependency — imported lazily so builds and
    // tests run without it when no transport is configured.
    const nodemailer = (await import("nodemailer")).default;

    const transporter = gmailUser && gmailPass
      ? nodemailer.createTransport({
          host: "smtp.gmail.com",
          port: 465,
          secure: true,
          auth: { user: gmailUser, pass: gmailPass },
        })
      : nodemailer.createTransport(smtpUrl!);

    const from = gmailUser ?? process.env.SMTP_FROM ?? "X <noreply@x.app>";
    await transporter.sendMail({ from, to: email, subject, text, html });
    return { ok: true, via: "email" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[otp] failed to send email to ${email}: ${message}`);
    return { ok: false, error: "Could not send the verification email — check SMTP settings and try again.", via };
  }
}
