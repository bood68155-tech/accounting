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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0b0d10] px-4">
      <div className="pointer-events-none absolute inset-0">
        <div className="bg-grid bg-grid-fade absolute inset-0" />
        <div className="glow-emerald absolute -top-24 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Link href="/">
            <Logo size={34} />
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {step === "verify" ? "Set a new password" : "Forgot your password?"}
            </CardTitle>
            <CardDescription>
              {step === "verify"
                ? `Enter the 6-digit code we sent to ${email}`
                : "We'll email you a 6-digit code to reset it"}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-5">
            {step === "email" ? (
              <form onSubmit={handleEmailSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    placeholder="you@gmail.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                {error && (
                  <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                    {error}
                  </p>
                )}

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Sending code…" : "Send reset code"}
                </Button>

                <p className="text-center text-xs text-zinc-500">
                  Remembered it?{" "}
                  <Link href="/login" className="font-medium text-emerald-400 hover:text-emerald-300">
                    Back to sign in
                  </Link>
                </p>
              </form>
            ) : (
              <form onSubmit={handleResetSubmit} className="space-y-5">
                {/* 6-digit code boxes */}
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
                        "h-12 w-11 text-center text-lg font-semibold tabular-nums",
                        digit && "border-emerald-500/60",
                      )}
                      aria-label={`Digit ${i + 1}`}
                    />
                  ))}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="new-password">New password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    required
                    minLength={6}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-password">Confirm new password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    required
                    minLength={6}
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>

                {devCode && (
                  <p className="rounded-lg border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-center font-mono text-sm text-sky-300">
                    Dev code: {devCode}
                  </p>
                )}
                {deliveryNote && !devCode && (
                  <p className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-center text-xs text-emerald-300">
                    {deliveryNote}
                  </p>
                )}
                {error && (
                  <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                    {error}
                  </p>
                )}

                <Button id="reset-password-submit" type="submit" className="w-full" disabled={verifying}>
                  {verifying ? "Resetting…" : "Reset password"}
                </Button>

                <div className="flex items-center justify-between text-xs">
                  <button
                    type="button"
                    className="text-zinc-500 transition-colors hover:text-zinc-300 disabled:opacity-50"
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
                    className="font-medium text-emerald-400 transition-colors hover:text-emerald-300 disabled:opacity-50"
                    onClick={() => void requestResetCode()}
                    disabled={cooldown > 0 || verifying}
                  >
                    {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
                  </button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-[11px] text-zinc-600">
          Reset codes expire in 10 minutes and can be used once
        </p>
      </div>
    </div>
  );
}
