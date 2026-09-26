"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";

/**
 * ── Auth form: credentials + Google OAuth + 6-digit email OTP ─────────────────
 * Three clean steps:
 *   1. Credentials (email + password, or "Continue with Google").
 *   2. Verify — a 6-digit code is emailed before any account is created or a
 *      session is opened (OTP request → verify → short-lived verified token).
 *   3. Session — signup (or login) completes with the verified token attached.
 */

type Mode = "login" | "signup";
type Step = "credentials" | "verify";

/** Google brand mark (multi-color "G", inline SVG — no icon library). */
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"
      />
    </svg>
  );
}

function isEmailValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // OTP step state
  const [code, setCode] = useState<string[]>(["", "", "", "", "", ""]);
  const [codeSending, setCodeSending] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [deliveryNote, setDeliveryNote] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const codeRefs = useRef<Array<HTMLInputElement | null>>([]);

  const googleEnabled = process.env.NEXT_PUBLIC_GOOGLE_ENABLED === "true";

  // Cooldown ticker for the resend button.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  function resetErrors() {
    setError(null);
  }

  // ── Step 1 → 2: request the OTP ────────────────────────────────────────────
  async function handleCredentialsSubmit(e: React.FormEvent) {
    e.preventDefault();
    resetErrors();

    if (!isEmailValid(email)) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    const ok = await requestOtp();
    setLoading(false);
    if (ok) setStep("verify");
  }

  async function requestOtp(): Promise<boolean> {
    setCodeSending(true);
    setDevCode(null);
    try {
      const res = await fetch("/api/auth/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, purpose: mode }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        delivery?: string;
        devCode?: string;
        retryAfterSeconds?: number;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not send the verification code. Please try again.");
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
        setDeliveryNote(`Code sent to ${email} — check your inbox (and spam folder).`);
      }
      setCode(["", "", "", "", "", ""]);
      setTimeout(() => codeRefs.current[0]?.focus(), 50);
      return true;
    } catch {
      setError("Network error — please try again.");
      return false;
    } finally {
      setCodeSending(false);
    }
  }

  // ── Step 2: verify the 6 digits, then sign in / sign up ────────────────────
  async function verifyAndContinue() {
    resetErrors();
    const joined = code.join("");
    if (!/^\d{6}$/.test(joined)) {
      setError("Enter all 6 digits of the code.");
      return;
    }

    setVerifying(true);
    try {
      // 1. Verify the code → short-lived verified token.
      const verifyRes = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, purpose: mode, code: joined }),
      });
      const verifyData = (await verifyRes.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        verifiedToken?: string;
      };
      if (!verifyRes.ok || !verifyData.ok || !verifyData.verifiedToken) {
        setError(verifyData.error ?? "Verification failed — please try again.");
        setVerifying(false);
        return;
      }

      // 2. Complete the flow with the verified token.
      if (mode === "signup") {
        const signupRes = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, otpToken: verifyData.verifiedToken }),
        });
        const signupData = (await signupRes.json().catch(() => ({}))) as { error?: string };
        if (!signupRes.ok) {
          setError(signupData.error ?? "Could not create the account. Please try again.");
          setVerifying(false);
          return;
        }
      }

      const result = await signIn("credentials", {
        email,
        password,
        otpToken: verifyData.verifiedToken,
        redirect: false,
      });
      if (result?.error) {
        setError(
          mode === "signup"
            ? "Account created but sign-in failed — please sign in manually."
            : "Incorrect email or password.",
        );
        setVerifying(false);
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Network error — please try again.");
      setVerifying(false);
    }
  }

  // ── Google OAuth ───────────────────────────────────────────────────────────
  function handleGoogleSignIn() {
    resetErrors();
    setGoogleLoading(true);
    // Full-page redirect into Google's consent screen; the signIn callback
    // provisions the account + tenant schema on first login.
    void signIn("google", { callbackUrl: "/dashboard" });
  }

  // ── OTP input plumbing ─────────────────────────────────────────────────────
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
      void verifyAndContinue();
    }
  }

  const isLogin = mode === "login";

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0b0d10] px-4">
      <div className="pointer-events-none absolute inset-0">
        <div className="bg-grid bg-grid-fade absolute inset-0" />
        <div className="glow-emerald absolute -top-24 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Link href="/"><Logo size={34} /></Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {step === "verify" ? "Verify your email" : isLogin ? "Welcome back" : "Create your account"}
            </CardTitle>
            <CardDescription>
              {step === "verify"
                ? `Enter the 6-digit code we sent to ${email}`
                : isLogin
                  ? "Sign in to your X workspace"
                  : "Start automating your bookkeeping"}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-5">
            {step === "credentials" ? (
              <div className="space-y-4">
                {googleEnabled && (
                  <>
                    <Button type="button" variant="outline" className="w-full" onClick={handleGoogleSignIn} disabled={googleLoading}>
                      <GoogleIcon className="h-4 w-4" />
                      {googleLoading ? "Redirecting to Google…" : "Continue with Google"}
                    </Button>
                    <div className="flex items-center gap-3 py-1" aria-hidden="true">
                      <div className="h-px flex-1 bg-zinc-800" />
                      <span className="text-[11px] uppercase tracking-wider text-zinc-600">or</span>
                      <div className="h-px flex-1 bg-zinc-800" />
                    </div>
                  </>
                )}

                <form onSubmit={handleCredentialsSubmit} className="space-y-4">
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
                  <div className="space-y-1.5">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      required
                      minLength={6}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>

                  {error && (
                    <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>
                  )}

                  <Button type="submit" className="w-full" disabled={loading || codeSending}>
                    {loading || codeSending ? "Sending code…" : isLogin ? "Continue" : "Send verification code"}
                  </Button>
                </form>

                <p className="text-center text-[11px] leading-relaxed text-zinc-600">
                  We&apos;ll email a 6-digit code to verify it&apos;s you before {isLogin ? "signing in" : "creating your account"}.
                </p>
              </div>
            ) : (
              <div className="space-y-5">
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
                  <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>
                )}

                <Button type="button" className="w-full" onClick={() => void verifyAndContinue()} disabled={verifying}>
                  {verifying ? "Verifying…" : isLogin ? "Verify & sign in" : "Verify & create account"}
                </Button>

                <div className="flex items-center justify-between text-xs">
                  <button
                    type="button"
                    className="text-zinc-500 transition-colors hover:text-zinc-300 disabled:opacity-50"
                    onClick={() => {
                      setStep("credentials");
                      setError(null);
                    }}
                    disabled={verifying}
                  >
                    ← Back
                  </button>
                  <button
                    type="button"
                    className="font-medium text-emerald-400 transition-colors hover:text-emerald-300 disabled:opacity-50"
                    onClick={() => void requestOtp()}
                    disabled={cooldown > 0 || codeSending || verifying}
                  >
                    {codeSending ? "Sending…" : cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
                  </button>
                </div>
              </div>
            )}

            {step === "credentials" && (
              <p className="mt-5 text-center text-xs text-zinc-500">
                {isLogin ? (
                  <>No account yet?{" "}<Link href="/signup" className="font-medium text-emerald-400 hover:text-emerald-300">Sign up</Link></>
                ) : (
                  <>Already have an account?{" "}<Link href="/login" className="font-medium text-emerald-400 hover:text-emerald-300">Sign in</Link></>
                )}
              </p>
            )}
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-[11px] text-zinc-600">
          Secured by verified email, encrypted credentials and tenant-isolated data
        </p>
      </div>
    </div>
  );
}
