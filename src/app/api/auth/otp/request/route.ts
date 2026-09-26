import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { isDatabaseConfigured, requireDb, publicSchema } from "@/lib/db";
import { issueOtp, type OtpPurpose } from "@/lib/auth/otp";

export const dynamic = "force-dynamic";

/**
 * ── OTP step 1: request a 6-digit email code ─────────────────────────────────
 * POST { email, purpose: "signup" | "login" }
 * → { ok, delivery, retryAfterSeconds? , devCode? }
 *
 * For signup the email must NOT have an account yet; for login it must.
 * Error details are deliberately vague about account existence where it
 * matters — but this is a first-party signup flow, so clarity wins.
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
    purpose?: string;
  };

  const email = (body.email ?? "").trim().toLowerCase();
  const purpose: OtpPurpose = body.purpose === "login" ? "login" : "signup";

  if (!email) {
    return NextResponse.json({ error: "Enter your email address." }, { status: 400 });
  }

  // Account-state checks (clear UX for a first-party flow).
  const db = requireDb();
  const { users } = publicSchema;
  const existing = await db
    .select({ id: users.id, disabled: users.disabled })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (purpose === "signup" && existing.length > 0) {
    return NextResponse.json(
      { error: "An account with this email already exists — sign in instead." },
      { status: 409 },
    );
  }
  if (purpose === "login" && existing.length === 0) {
    return NextResponse.json({ error: "No account found — sign up first." }, { status: 404 });
  }
  if (existing[0]?.disabled) {
    return NextResponse.json({ error: "This account has been disabled." }, { status: 403 });
  }

  const result = await issueOtp(email, purpose);
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
