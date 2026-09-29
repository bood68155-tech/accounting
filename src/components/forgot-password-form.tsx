"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";

/**
 * ── Forgot password / reset password (6-digit email OTP) ──────────────────────
 * Two steps:
 *   1. Email — request a reset code (POST /api/auth/password/reset/request).
 *   2. Verify — the 6-digit code + the new password (POST /api/auth/password/reset).
 * On success the user is redirected to /login with a success message.
 *
 * Presentation: editorial brutalist — flat black card, 1px white frame, hard
 * signal-red offset shadow, ALL-CAPS headings, outlined OTP cells.
 */

type Step = "email" | "verify";

function isEmailValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function ForgotPasswordForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deliveryNote, setDeliveryNote] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);

  // OTP step state
  const [code, setCode] = useState<string[]>(["", "", "", "", "", ""]);
  const [cooldown, setCooldown] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const codeRefs = useRef<Array<HTMLInputElement | null>>([]);

  // Cooldown ticker for the resend button.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  // ── Step 1: request the reset code ────────────────────────────────────────
  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isEmailValid(email)) {
      setError("Enter a valid email address.");
      return;
    }

    setLoading(true);
    const ok = await requestResetCode();
    setLoading(false);
    if (ok) setStep("verify");
  }

  async function requestResetCode(): Promise<boolean> {
    setError(null);
    setDevCode(null);
    try {
      const res = await fetch("/api/auth/password/reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        delivery?: string;
        devCode?: string;
        retryAfterSeconds?: number;
      };
      if (!res.ok || !data.ok) {
        // The API returns JSON for every failure mode (bad request, rate
        // limit, Resend sandbox restriction, DB outage). Fall back to a
        // generic message only if the response body itself is unreadable.
        setError(
          data.error ??
            (res.status >= 500
              ? "The service is temporarily unavailable. Please try again in a few minutes."
              : "Could not send the reset code. Please try again."),
        );
        if (data.retryAfterSeconds) setCooldown(data.retryAfterSeconds);
        return false;
      }
      setCooldown(45);
      if (data.devCode) {
        setDevCode(data.devCode);
        setDeliveryNote(
          data.delivery === "console"
            ? "Dev bypass active — use the code below (no email was sent)."
            : "Dev mode: code shown below.",
        );
      } else {
        setDeliveryNote(`Reset code sent to ${email} — check your inbox (and spam folder).`);
      }
      setCode(["", "", "", "", "", ""]);
      setTimeout(() => codeRefs.current[0]?.focus(), 50);
      return true;
    } catch {
      setError("Network error — please try again.");
      return false;
    }
  }

  // ── Step 2: verify the code and set the new password ──────────────────────
  async function handleResetSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const joined = code.join("");
    if (!/^\d{6}$/.test(joined)) {
      setError("Enter all 6 digits of the code.");
      return;
    }
    if (password.length < 6) {
      setError("New password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setVerifying(true);
    try {
      const res = await fetch("/api/auth/password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: joined, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not reset the password. Please try again.");
        setVerifying(false);
        return;
      }
      router.push("/login?reset=success");
    } catch {
      setError("Network error — please try again.");
      setVerifying(false);
    }
  }

  // ── OTP input plumbing (same UX as the login/signup code boxes) ───────────
  function setDigit(index: number, value: string) {
    const digits = value.replace(/\D/g, "");
    if (digits.length > 1) {
      // Paste (or autofill) across boxes.
      const next = [...code];
      for (let i = 0; i < 6 && i < digits.length; i += 1) next[i] = digits[i];
      setCode(next);
      codeRefs.current[Math.min(5, digits.length - 1)]?.focus();
      return;
    }
    const next = [...code];
    next[index] = digits;
    setCode(next);
    if (digits && index < 5) codeRefs.current[index + 1]?.focus();
  }

  function onDigitKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !code[index] && index > 0) {
      codeRefs.current[index - 1]?.focus();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      document.getElementById("reset-password-submit")?.click();
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-app px-4 py-10 sm:px-6">
      <p className="type-kicker pointer-events-none absolute left-4 top-4 text-zinc-700 sm:left-6 sm:top-6">
        X / Accounts — 02 Reset
      </p>
      <p className="type-kicker pointer-events-none absolute bottom-4 right-4 text-zinc-700 sm:bottom-6 sm:right-6">
        Secure / Verified / Tenant-Isolated
      </p>

      <div className="animate-fade-up relative z-10 w-full max-w-[420px]">
        <div className="mb-8 flex justify-center">
          <Link href="/" className="transition-opacity duration-100 hover:opacity-70">
            <Logo size={38} />
          </Link>
        </div>

        <Card className="shadow-[8px_8px_0_0_#ff3b00]">
          <CardHeader className="border-b border-white p-6 pb-5">
            <CardTitle className="text-2xl font-extrabold uppercase tracking-[-0.02em] text-white">
              {step === "verify" ? "Set a new password" : "Forgot your password?"}
            </CardTitle>
            <CardDescription className="mt-1.5 text-[13px] leading-relaxed text-zinc-400">
              {step === "verify"
                ? `Enter the 6-digit code we sent to ${email}`
                : "We'll email you a 6-digit code to reset it"}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6 pt-6">
            {step === "email" ? (
              <form onSubmit={handleEmailSubmit} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                {error && (
                  <p
                    role="alert"
                    className="border border-red-500 bg-red-500/10 px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-red-400"
                  >
                    {error}
                  </p>
                )}

                <Button type="submit" className="h-12 w-full font-semibold uppercase tracking-[0.08em]" disabled={loading}>
                  {loading ? "Sending code…" : "Send reset code"}
                </Button>

                <p className="border-t border-zinc-800 pt-4 text-center text-[11px] uppercase tracking-[0.1em] text-zinc-500">
                  Remembered it?{" "}
                  <Link href="/login" className="font-bold text-accent transition-colors duration-100 hover:text-white">
                    Back to sign in
                  </Link>
                </p>
              </form>
            ) : (
              <form onSubmit={handleResetSubmit} className="space-y-6">
                {/* 6-digit code cells — outlined, square, high-contrast */}
                <div className="flex justify-center gap-2">
                  {code.map((digit, i) => (
                    <Input
                      key={i}
                      ref={(el) => {
                        codeRefs.current[i] = el;
                      }}
                      value={digit}
                      onChange={(e) => setDigit(i, e.target.value)}
                      onKeyDown={(e) => onDigitKeyDown(i, e)}
                      inputMode="numeric"
                      autoComplete={i === 0 ? "one-time-code" : "off"}
                      maxLength={6}
                      className={cn(
                        "h-14 w-10 px-0 text-center text-xl font-bold tabular-nums sm:w-11",
                        digit
                          ? "border-accent text-white"
                          : "hover:border-zinc-500",
                      )}
                      aria-label={`Digit ${i + 1}`}
                    />
                  ))}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="new-password">New password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm new password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>

                {devCode && (
                  <p className="border border-white bg-white px-3 py-2.5 text-center font-mono text-sm font-bold tracking-[0.3em] text-black">
                    {devCode}
                  </p>
                )}
                {deliveryNote && !devCode && (
                  <p className="border border-accent bg-accent/10 px-3 py-2.5 text-center text-xs font-medium uppercase tracking-wide text-accent">
                    {deliveryNote}
                  </p>
                )}
                {error && (
                  <p
                    role="alert"
                    className="border border-red-500 bg-red-500/10 px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-red-400"
                  >
                    {error}
                  </p>
                )}

                <Button id="reset-password-submit" type="submit" className="h-12 w-full font-semibold uppercase tracking-[0.08em]" disabled={verifying}>
                  {verifying ? "Resetting…" : "Reset password"}
                </Button>

                <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.1em]">
                  <button
                    type="button"
                    className="text-zinc-500 transition-colors duration-100 hover:text-white disabled:opacity-40"
                    onClick={() => {
                      setStep("email");
                      setError(null);
                      setPassword("");
                      setConfirmPassword("");
                    }}
                    disabled={verifying}
                  >
                    ← Back
                  </button>
                  <button
                    type="button"
                    className="text-accent transition-colors duration-100 hover:text-white disabled:opacity-40"
                    onClick={() => void requestResetCode()}
                    disabled={cooldown > 0 || verifying}
                  >
                    {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                  </button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
