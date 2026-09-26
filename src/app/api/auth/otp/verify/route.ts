import { NextRequest, NextResponse } from "next/server";
import { verifyOtp } from "@/lib/auth/otp";
import { createVerifiedToken } from "@/lib/auth/verification";

export const dynamic = "force-dynamic";

/**
 * ── OTP step 2: verify the 6-digit code ──────────────────────────────────────
 * POST { email, purpose, code }
 * → { ok, verifiedToken }
 *
 * On success returns a short-lived (10 min) HMAC "verifiedToken" bound to
 * email+purpose. The signup endpoint and the credentials sign-in flow require
 * this token, so an account can only be created / a session only established
 * after the mailbox was actually proven.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    purpose?: string;
    code?: string;
  };

  const email = (body.email ?? "").trim().toLowerCase();
  const purpose = body.purpose === "login" ? "login" : "signup";
  const code = (body.code ?? "").trim();

  if (!email || !code) {
    return NextResponse.json({ error: "Provide the email and the 6-digit code." }, { status: 400 });
  }

  try {
    const result = await verifyOtp(email, purpose, code);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, verifiedToken: createVerifiedToken(email, purpose) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Verification failed: ${message}` }, { status: 500 });
  }
}
