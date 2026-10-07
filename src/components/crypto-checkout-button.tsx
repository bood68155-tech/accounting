"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { IconCoin } from "@/components/icons";

/**
 * ── Automated USDT / crypto checkout ──────────────────────────────────────────
 * Asks the server for a hosted NOWPayments invoice and sends the payer there.
 * Confirmation is fully automated via /api/webhooks/payments — no admin step.
 */
export function CryptoCheckoutButton({ amountLabel }: { amountLabel: string }) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function onClick() {
    setMessage(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/payments/crypto", { method: "POST" });
        const data = (await response.json()) as { ok?: boolean; invoiceUrl?: string; error?: string };
        if (!response.ok || !data.ok || !data.invoiceUrl) {
          setMessage(data.error ?? "Could not start crypto checkout. Use the manual option below.");
          return;
        }
        window.location.href = data.invoiceUrl;
      } catch {
        setMessage("Network error starting crypto checkout. Use the manual option below.");
      }
    });
  }

  return (
    <div className="space-y-3">
      <Button
        type="button"
        className="w-full"
        disabled={isPending}
        onClick={onClick}
      >
        <IconCoin className="mr-2 h-4 w-4" />
        {isPending ? "Opening secure checkout…" : `Pay ${amountLabel} with crypto (auto-activated)`}
      </Button>
      <p className="text-center text-xs text-zinc-500">
        Pay with USDT or another supported coin — access unlocks automatically once the
        network confirms your transfer.
      </p>
      {message && (
        <p role="status" className="border border-zinc-700 px-3 py-2 text-xs font-medium text-amber-300">
          {message}
        </p>
      )}
    </div>
  );
}
