"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/logo";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch(
        mode === "signup" ? "/api/auth/signup" : "/api/auth/signin",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };

      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    } catch {
      setError("Network error — please try again.");
    }
    setLoading(false);
  }

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
            <CardTitle className="text-lg">{mode === "login" ? "Welcome back" : "Create your account"}</CardTitle>
            <CardDescription>
              {mode === "login" ? "Sign in to your X workspace" : "Start automating your bookkeeping"}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-5">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" required placeholder="you@store.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" required minLength={6} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>

              {error && (
                <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>
              )}
              {message && (
                <p className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{message}</p>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
              </Button>
            </form>

            <p className="mt-5 text-center text-xs text-zinc-500">
              {mode === "login" ? (
                <>No account yet?{" "}<Link href="/signup" className="font-medium text-emerald-400 hover:text-emerald-300">Sign up</Link></>
              ) : (
                <>Already have an account?{" "}<Link href="/login" className="font-medium text-emerald-400 hover:text-emerald-300">Sign in</Link></>
              )}
            </p>
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-[11px] text-zinc-600">
          Secured by encrypted credentials and tenant-isolated data
        </p>
      </div>
    </div>
  );
}
