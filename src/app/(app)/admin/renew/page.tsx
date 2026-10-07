import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { IconCoin, IconShield } from "@/components/icons";
import { PendingPaymentsTab } from "@/components/admin/pending-payments-tab";
import { createPendingPayment } from "@/lib/admin/billing-actions";
import { fetchAdminBillingData } from "@/lib/admin/billing-queries";
import { formatCurrency, cn } from "@/lib/utils";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export const metadata: Metadata = { title: "Binance Pay Renewal" };

const BINANCE_PAY_ID = "1274571525";
const DEFAULT_AMOUNT_USD = 30;

export default async function RenewPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!isAdminEmail(session.user.email)) redirect("/dashboard");

  const billing = await fetchAdminBillingData();
  const defaultPlan = billing.plans.find((p) => p.isDefault) ?? billing.plans[0] ?? null;

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-white px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="frame-icon h-9 w-9">
            <IconShield className="h-4.5 w-4.5 text-accent" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-bold uppercase tracking-[0.04em] text-white">
              Binance Pay Renewal
            </h1>
            <p className="type-kicker truncate text-zinc-500">Manual USDT transfer · Pay ID {BINANCE_PAY_ID}</p>
          </div>
        </div>
        <Badge variant="default">Restricted</Badge>
      </header>

      <div className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-6 py-6">
        <div className="grid gap-6 xl:grid-cols-5">
          <div className="xl:col-span-3 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Renew with Binance Pay</CardTitle>
                <CardDescription>
                  Send USDT to the Pay ID below, then submit your Transaction ID (TxID) to request renewal.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 pt-2">
                <div className="flex items-start gap-4">
                  <div className="frame-icon h-10 w-10 shrink-0">
                    <IconCoin className="h-5 w-5 text-accent" />
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.1em] text-zinc-500">Binance Pay ID</p>
                    <p className="mt-1 text-xl font-mono font-bold text-white">{BINANCE_PAY_ID}</p>
                  </div>
                </div>

                <div className="border border-zinc-800 rounded-none p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.1em] text-zinc-500">Instructions</p>
                  <ol className="mt-3 space-y-2 text-sm text-zinc-300">
                    <li className="flex gap-3">
                      <span className="shrink-0 border border-accent bg-accent/10 px-2 py-0.5 text-accent text-[10px] font-bold uppercase">1</span>
                      <span>Open Binance Pay &gt; Send USDT &gt; enter Pay ID <strong className="text-white font-mono">{BINANCE_PAY_ID}</strong></span>
                    </li>
                    <li className="flex gap-3">
                      <span className="shrink-0 border border-accent bg-accent/10 px-2 py-0.5 text-accent text-[10px] font-bold uppercase">2</span>
                      <span>Send the renewal amount (default <strong className="text-white">{formatCurrency(DEFAULT_AMOUNT_USD, defaultPlan?.currency ?? "USD")}</strong>)</span>
                    </li>
                    <li className="flex gap-3">
                      <span className="shrink-0 border border-accent bg-accent/10 px-2 py-0.5 text-accent text-[10px] font-bold uppercase">3</span>
                      <span>Copy the Transaction ID (TxID) from Binance and submit it below</span>
                    </li>
                  </ol>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="amount">Amount (USDT)</Label>
                    <Input
                      id="amount"
                      type="number"
                      min="1"
                      step="0.01"
                      defaultValue={DEFAULT_AMOUNT_USD}
                      className="font-mono text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="plan">Plan</Label>
                    <Select id="plan" defaultValue={defaultPlan?.code ?? ""}>
                      {billing.plans.map((p) => (
                        <option key={p.id} value={p.code}>
                          {p.name} — {formatCurrency(p.monthlyPrice, p.currency)}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>

                <PendingPaymentForm
                  defaultPlanCode={defaultPlan?.code ?? null}
                  defaultAmount={DEFAULT_AMOUNT_USD}
                  defaultPlanName={defaultPlan?.name ?? null}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Your subscription</CardTitle>
                <CardDescription>Current plan and renewal status</CardDescription>
              </CardHeader>
              <CardContent className="pt-2">
                {session.user ? (
                  <div className="space-y-3">
                    <div className="border border-zinc-800 px-4 py-3">
                      <p className="text-xs text-zinc-500">Email</p>
                      <p className="font-medium text-white">{session.user.email}</p>
                    </div>
                    <div className="border border-zinc-800 px-4 py-3">
                      <p className="text-xs text-zinc-500">Plan</p>
                      <p className="font-medium text-white">{defaultPlan?.name ?? "—"}</p>
                    </div>
                    <div className="border border-zinc-800 px-4 py-3">
                      <p className="text-xs text-zinc-500">Monthly price</p>
                      <p className="font-medium text-white">
                        {defaultPlan ? formatCurrency(defaultPlan.monthlyPrice, defaultPlan.currency) : "—"}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-zinc-500">Sign in to view your subscription.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="xl:col-span-2 space-y-6">
            <PendingPaymentsTab data={billing} />
          </div>
        </div>
      </div>
    </main>
  );
}

function PendingPaymentForm({
  defaultPlanCode,
  defaultAmount,
  defaultPlanName,
}: {
  defaultPlanCode: string | null;
  defaultAmount: number;
  defaultPlanName: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    payId: BINANCE_PAY_ID,
    txId: "",
    amountUsd: String(defaultAmount),
    planCode: defaultPlanCode ?? "",
  });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
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
      const user = await auth();
      if (!user?.user?.id) {
        setMessage("Unable to identify the current user.");
        return;
      }

      const result = await createPendingPayment({
        userId: user.user.id,
        payId: form.payId,
        txId: form.txId.trim(),
        amountUsd: amount,
        planCode: form.planCode,
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

      <Button
        type="submit"
        className="w-full"
        disabled={isPending}
      >
        {isPending ? "Submitting… · admin approval required" : "Submit Binance Pay invoice"}
      </Button>
    </form>
  );
}
