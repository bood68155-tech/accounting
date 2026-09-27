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

export async function sendOtpViaResend(
  email: string,
  code: string,
  purpose: "signup" | "login",
  minutes: number,
): Promise<SendOtpResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, via: "console", error: "RESEND_API_KEY is not configured." };
  }

  try {
    // Lazy import keeps builds/tests working without the SDK at module load.
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);

    const { error } = await resend.emails.send({
      from: otpFromAddress(),
      to: [email],
      subject: `Your verification code: ${code}`,
      replyTo: process.env.EMAIL_REPLY_TO?.trim() || undefined,
      react: OtpEmail({ code, purpose, minutes }),
    });

    if (error) {
      // Canonical SDK failure shape: { name, message }.
      return {
        ok: false,
        via: "email",
        error: `Resend: ${error.message ?? error.name ?? "send failed"}`,
      };
    }
    return { ok: true, via: "email" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, via: "email", error: `Resend: ${message}` };
  }
}
