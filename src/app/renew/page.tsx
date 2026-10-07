import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IconCoin, IconShield } from "@/components/icons";
import { PendingPaymentForm } from "@/components/admin/pending-payment-form";
import { submitRenewalRequest } from "@/lib/admin/billing-actions";
import { resolveSubscriptionAccess } from "@/lib/subscription/access";
import { isDatabaseConfigured, publicSchema, requireDb } from "@/lib/db";
import { formatCurrency } from "@/lib/utils";

export const metadata: Metadata = { title: "Renew subscription" };

const BINANCE_PAY_ID = "1274571525";
const DEFAULT_AMOUNT_USD = 30;

export default async function RenewSubscriptionPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const access = await resolveSubscriptionAccess(session.user.id, session.user.email);

  let planName: string | null = null;
  let planCode: string | null = null;
  let planPrice = DEFAULT_AMOUNT_USD;
  let currency = "USD";
  if (isDatabaseConfigured()) {
    const { subscriptionPlans } = publicSchema;
    const plans = await requireDb()
      .select()
      .from(subscriptionPlans)
      .orderBy(subscriptionPlans.monthlyPrice);
    const plan = plans.find((p) => p.isDefault) ?? plans[0] ?? null;
    if (plan) {
      planName = plan.name;
      planCode = plan.code;
      planPrice = plan.monthlyPrice;
      currency = plan.currency;
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-app px-4 py-10">
      <div className="w-full max-w-xl space-y-6">
        <header className="flex items-center gap-3">
          <div className="frame-icon h-9 w-9">
            <IconShield className="h-4.5 w-4.5 text-accent" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-bold uppercase tracking-[0.04em] text-white">
              Renew subscription
            </h1>
            <p className="type-kicker truncate text-zinc-500">
              Manual USDT transfer · Pay ID {BINANCE_PAY_ID}
            </p>
          </div>
          <Badge variant={access.allowed ? "success" : "warning"}>
            {access.allowed ? "Active" : "Renewal required"}
          </Badge>
        </header>

        {!access.allowed && (
          <Card>
            <CardHeader>
              <CardTitle>Your trial has ended</CardTitle>
              <CardDescription>{access.message}</CardDescription>
            </CardHeader>
            <CardContent className="pt-2 text-sm text-zinc-400">
              Send USDT below and submit your TxID. Access is restored once the admin
              approves your payment.
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Renew with Binance Pay</CardTitle>
            <CardDescription>
              Send USDT to the Pay ID below, then submit your Transaction ID (TxID).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 pt-2">
            <div className="flex items-start gap-4">
              <div className="frame-icon h-10 w-10 shrink-0">
                <IconCoin className="h-5 w-5 text-accent" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.1em] text-zinc-500">
                  Binance Pay ID
                </p>
                <p className="mt-1 text-xl font-mono font-bold text-white">{BINANCE_PAY_ID}</p>
              </div>
            </div>

            <div className="space-y-3 border border-zinc-800 p-4 text-sm text-zinc-300">
              <p>
                Open Binance Pay → Send USDT → enter Pay ID{" "}
                <strong className="font-mono text-white">{BINANCE_PAY_ID}</strong>, then send{" "}
                <strong className="text-white">{formatCurrency(planPrice, currency)}</strong>.
              </p>
              <p>Copy the Transaction ID (TxID) from Binance and submit it below.</p>
              {planName && (
                <p className="text-xs text-zinc-500">
                  Plan: {planName} · {formatCurrency(planPrice, currency)} / month
                </p>
              )}
            </div>

            <PendingPaymentForm
              action={submitRenewalRequest}
              defaultPlanCode={planCode}
              defaultAmount={planPrice}
              payId={BINANCE_PAY_ID}
            />
          </CardContent>
        </Card>

        <p className="text-center text-xs text-zinc-500">
          <Link href="/dashboard" className="text-accent hover:underline">
            Back to dashboard
          </Link>
        </p>
      </div>
    </main>
  );
}
