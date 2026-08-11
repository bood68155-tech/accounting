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
    <main className="flex min-h-screen items-center justify-center bg-[#0b0d10] px-6">
      <Card className="w-full max-w-sm animate-fade-up">
        <CardHeader className="items-center pb-2 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-500/25 bg-emerald-500/10 text-emerald-400">
            <IconShield className="h-6 w-6" />
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
