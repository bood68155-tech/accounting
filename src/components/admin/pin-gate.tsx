"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IconShield } from "@/components/icons";
import { Input } from "@/components/ui/input";
import { verifyAdminPin } from "@/app/(app)/admin/actions";

export function PinGate() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setError(null);
    const formData = new FormData(form);

    startTransition(async () => {
      const result = await verifyAdminPin(formData);
      if (!result.ok) {
        setError(result.error);
        const pinInput = form.elements.namedItem("pin") as HTMLInputElement | null;
        pinInput?.select();
        return;
      }
      // Cookie is set server-side; a fresh page render picks it up.
      window.location.reload();
    });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-app px-6">
      <p className="type-kicker pointer-events-none absolute left-4 top-4 text-zinc-700 sm:left-6 sm:top-6">X / Admin — Restricted</p>
      <Card className="w-full max-w-sm animate-fade-up">
        <CardHeader className="border-b border-white pb-4 text-center">
          <div className="frame-icon mx-auto mb-3">
            <IconShield className="h-6 w-6 text-accent" />
          </div>
          <CardTitle className="text-lg">Admin access</CardTitle>
          <CardDescription>Enter the admin PIN to open the console</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="admin-pin"
                className="text-xs font-medium text-zinc-400"
              >
                PIN
              </label>
              <Input
                id="admin-pin"
                name="pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                placeholder="••••"
                maxLength={32}
                className="text-center text-lg tracking-[0.35em]"
                aria-invalid={error ? true : undefined}
              />
            </div>

            {error && (
              <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-xs font-medium text-red-400">
                {error}
              </p>
            )}

            <Button type="submit" size="lg" className="w-full" disabled={pending}>
              {pending ? "Verifying…" : "Unlock admin"}
            </Button>
          </form>

          <p className="mt-5 text-center text-[11px] text-zinc-600">
            Restricted area — authorized administrators only.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
