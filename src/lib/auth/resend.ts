import { OtpEmail } from "@/components/emails/otp-code";

/**
 * ── Resend delivery (canonical SDK + React Email pattern) ─────────────────────
 * Per resend.com/docs/send-with-nextjs:
 *   const resend = new Resend(process.env.RESEND_API_KEY);
 *   await resend.emails.send({ from, to, subject, react: <Template /> });
 *
 * The SDK returns `{ data, error }` — `error` is set on failure (invalid from,
 * unverified domain, testing-sender rejection…). We surface that verbatim so
 * the caller can decide how to degrade.
 */

export interface SendOtpResult {
  ok: boolean;
  /** "email" when accepted by Resend; "console" when no transport is configured. */
  via: "email" | "console";
  /** Human-readable reason when ok=false (API error message when available). */
  error?: string;
}

/** The From identity — configurable via env, falls back to Resend's sandbox. */
export function otpFromAddress(): string {
  const name = process.env.EMAIL_FROM_NAME?.trim() || "StoreAccountant";
  const address =
    process.env.EMAIL_FROM?.trim() ||
    process.env.SMTP_FROM?.trim() ||
    "onboarding@resend.dev";
  // If EMAIL_FROM already carries a display name ("Name <a@b.c>"), keep it as-is.
  return /<.+>/.test(address) ? address : `${name} <${address}>`;
}

export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

/**
 * Build a helpful user-facing message from a Resend API failure.
 * Resend's sandbox (testing) mode — an unverified `onboarding@resend.dev`
 * sender — only delivers to the account owner's email; every other address
 * is rejected (403 "You can only send testing emails to your own email
 * address"). Detect that case and tell the user WHY, instead of a generic
 * failure.
 */
export function resendSandboxErrorMessage(rawError: string): string {
  const err = rawError.toLowerCase();
  if (
    err.includes("testing emails") ||
    err.includes("test emails") ||
    err.includes("only send testing") ||
    err.includes("own email address") ||
    err.includes("verify a domain") ||
    err.includes("verify your domain") ||
    (err.includes("403") && err.includes("resend"))
  ) {
    const owner = process.env.OTP_SANDBOX_OWNER_EMAIL?.trim() || "the account owner's email";
    return (
      "Email delivery is restricted by Resend's testing sandbox — until a custom domain is verified in Resend, " +
      `codes can only be sent to ${owner}. ` +
      "Try that address, or verify your domain at resend.com/domains to lift the restriction."
    );
  }
  return rawError;
}

export async function sendOtpViaResend(
  email: string,
  code: string,
  purpose: "signup" | "login" | "password_reset",
  minutes: number,
): Promise<SendOtpResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, via: "console", error: "RESEND_API_KEY is not configured." };
  }

  // Password-reset emails carry the dedicated "Reset Your Password" subject;
  // signup/login keep the verification-code subject.
  const subject =
    purpose === "password_reset" ? "Reset Your Password" : `Your verification code: ${code}`;

  try {
    // Lazy import keeps builds/tests working without the SDK at module load.
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);

    const { error } = await resend.emails.send({
      from: otpFromAddress(),
      to: [email],
      subject,
      replyTo: process.env.EMAIL_REPLY_TO?.trim() || undefined,
      react: OtpEmail({ code, purpose, minutes }),
    });

    if (error) {
      // Canonical SDK failure shape: { name, message }.
      const raw = `Resend: ${error.message ?? error.name ?? "send failed"}`;
      return { ok: false, via: "email", error: resendSandboxErrorMessage(raw) };
    }
    return { ok: true, via: "email" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, via: "email", error: resendSandboxErrorMessage(`Resend: ${message}`) };
  }
}
