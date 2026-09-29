import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { resetOtpIssue } from "@/lib/auth/otp";

export const dynamic = "force-dynamic";

/**
 * ── Forgot password, step 1: send a reset code ───────────────────────────────
 * POST { email }
 * → { ok, delivery, retryAfterSeconds?, devCode? }
 *
 * Verifies the account exists, generates a 6-digit code, stores its bcrypt
 * hash with a 10-minute expiry, and emails it via the configured transport
 * (Resend API when RESEND_API_KEY is set) with the subject
 * "Reset Your Password".
 *
 * Account enumeration: like the login OTP route, a clear error is returned for
 * unknown addresses — this is a first-party flow, so clarity wins.
 */
export async function POST(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Database is not configured — set DATABASE_URL (Neon) in the environment." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { email?: string };
  const email = (body.email ?? "").trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Enter your email address." }, { status: 400 });
  }

  const result = await resetOtpIssue(email);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, retryAfterSeconds: result.retryAfterSeconds },
      { status: result.retryAfterSeconds ? 429 : 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    delivery: result.delivery,
    retryAfterSeconds: result.retryAfterSeconds,
    // Only present in non-production without an email transport (dev/test).
    devCode: result.devCode,
  });
}
