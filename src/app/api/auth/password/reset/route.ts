import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { isDatabaseConfigured, requireDb, publicSchema } from "@/lib/db";
import { resetOtpConsume } from "@/lib/auth/otp";

export const dynamic = "force-dynamic";

/**
 * ── Forgot password, step 2: verify code + set the new password ──────────────
 * POST { email, code, password }
 * → { ok }
 *
 * Verifies the 6-digit code against otp_codes (purpose 'password_reset'),
 * updates public.users.password_hash with the new bcrypt hash, deletes the
 * consumed OTP row (single use), and revokes every refresh token by bumping
 * the user's token version — existing sessions are signed out on their next
 * request, so a stolen session cannot survive a password reset.
 *
 * Only accounts with a local password can be reset through this flow; Google
 * OAuth accounts (passwordHash = null) are told to sign in with Google.
 */
export async function POST(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Database is not configured — set DATABASE_URL (Neon) in the environment." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    code?: string;
    password?: string;
  };
  const email = (body.email ?? "").trim().toLowerCase();
  const code = (body.code ?? "").trim();
  const password = body.password ?? "";

  if (!email || !code) {
    return NextResponse.json({ error: "Provide the email and the 6-digit code." }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json(
      { error: "New password must be at least 6 characters." },
      { status: 400 },
    );
  }

  const db = requireDb();
  const { users } = publicSchema;

  // Guard against resetting Google-only accounts: they have no local
  // credential, so "resetting" would create a password behind the user's back.
  let userRows;
  try {
    userRows = await db
      .select({ id: users.id, disabled: users.disabled, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
  } catch (error) {
    // DB unreachable (stale DATABASE_URL, Neon outage…) — clean JSON, no empty 500.
    console.error(
      "[password-reset] DB unreachable while looking up user:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      {
        error:
          "The service is temporarily unavailable (database connection failed). Please try again in a few minutes.",
      },
      { status: 503 },
    );
  }
  const user = userRows[0];
  if (!user) {
    return NextResponse.json({ error: "No account found for this email." }, { status: 404 });
  }
  if (user.disabled) {
    return NextResponse.json({ error: "This account has been disabled." }, { status: 403 });
  }
  if (!user.passwordHash) {
    return NextResponse.json(
      { error: "This account signs in with Google — use “Continue with Google” on the sign-in page." },
      { status: 400 },
    );
  }

  // Verify AND delete the reset code in one step (single use).
  const otpResult = await resetOtpConsume(email, code);
  if (!otpResult.ok) {
    return NextResponse.json({ error: otpResult.error }, { status: 400 });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, user.id));

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Password reset failed: ${message}` }, { status: 500 });
  }
}
