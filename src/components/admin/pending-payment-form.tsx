"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const BINANCE_PAY_ID = "1274571525";

export interface RenewalActionInput {
  payId: string;
  txId: string;
  amountUsd: number;
  planCode: string | null;
}

export type RenewalAction = (
  input: RenewalActionInput,
) => Promise<{ ok: true } | { ok: false; error: string }>;

/**
 * ── Manual Binance Pay submission form ────────────────────────────────────────
 * Client-only: collects the TxID (and the fixed Pay ID) and files a pending
 * payment for admin approval. The caller passes the server action to invoke
 * (`submitRenewalRequest` for self-serve, `createPendingPayment` for admin).
 */
export function PendingPaymentForm({
  action,
  defaultPlanCode,
  defaultAmount,
  payId = BINANCE_PAY_ID,
}: {
  action: RenewalAction;
  defaultPlanCode: string | null;
  defaultAmount: number;
  payId?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    payId,
    txId: "",
    amountUsd: String(defaultAmount),
    planCode: defaultPlanCode ?? "",
  });

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);

    const amount = Number.parseFloat(form.amountUsd);
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage("Enter a valid positive amount.");
      return;
    }
    if (!form.txId.trim()) {
      setMessage("Please enter the Transaction ID (TxID).");
      return;
    }

    startTransition(async () => {
      const result = await action({
        payId: form.payId,
        txId: form.txId.trim(),
        amountUsd: amount,
        planCode: form.planCode || null,
      });

      if (!result.ok) {
        setMessage(result.error);
        return;
      }

      setMessage("Invoice queued — your TxID is now pending admin approval.");
      router.refresh();
    });
  }

  return (
    <form className="space-y-4 pt-2" onSubmit={onSubmit}>
      <div className="space-y-1.5">
        <Label htmlFor="tx-id">Transaction ID (TxID)</Label>
        <Input
          id="tx-id"
          value={form.txId}
          onChange={(e) => setForm((f) => ({ ...f, txId: e.target.value }))}
          placeholder="Paste Binance Pay TxID here"
          className="font-mono text-sm"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pay-id">Pay ID</Label>
          <Input id="pay-id" value={form.payId} readOnly className="bg-zinc-800/40 text-zinc-300" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="plan-code">Plan code</Label>
          <Input id="plan-code" value={form.planCode} readOnly className="bg-zinc-800/40 text-zinc-300" />
        </div>
      </div>

      {message && (
        <p role="status" className="border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300">
          {message}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Submitting… · admin approval required" : "Submit Binance Pay invoice"}
      </Button>
    </form>
  );
}
