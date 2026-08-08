"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IconCheck, IconStore, IconWebhook } from "@/components/icons";
import { cn } from "@/lib/utils";

type Platform = "shopify" | "woocommerce" | "stripe" | "paypal";

const PLATFORMS: Array<{ id: Platform; name: string; blurb: string }> = [
  { id: "shopify", name: "Shopify", blurb: "Orders, refunds & Shopify Payments fees" },
  { id: "woocommerce", name: "WooCommerce", blurb: "WordPress store orders" },
  { id: "stripe", name: "Stripe", blurb: "Payment gateway fees & payouts" },
  { id: "paypal", name: "PayPal", blurb: "Checkout orders & transaction fees" },
];

const STEP_LABELS = ["Store details", "Webhook endpoint", "Done"];

export function StoreConnect({ onClose }: { onClose?: () => void }) {
  const [step, setStep] = useState(0);
  const [platform, setPlatform] = useState<Platform>("shopify");
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");

  const webhookUrl = `${typeof window !== "undefined" ? window.location.origin : "https://app.store-accountant.com"}/api/webhooks/${platform}`;

  const canNext = step === 0 && name.trim().length > 0;

  return (
    <Card className="w-full max-w-lg overflow-hidden">
      {/* Header */}
      <div className="border-b border-zinc-800/70 p-5">
        <div className="flex items-center gap-2">
          <IconStore className="h-5 w-5 text-emerald-400" />
          <h3 className="text-base font-semibold text-zinc-50">Connect a store</h3>
        </div>
        <div className="mt-4 flex items-center gap-2">
          {STEP_LABELS.map((label, i) => (
            <div key={label} className="flex flex-1 flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold transition-colors",
                    i < step
                      ? "bg-emerald-500 text-emerald-950"
                      : i === step
                        ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/50"
                        : "bg-zinc-800 text-zinc-500",
                  )}
                >
                  {i < step ? <IconCheck className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className={cn("text-[11px] font-medium", i <= step ? "text-zinc-300" : "text-zinc-600")}>
                  {label}
                </span>
              </div>
              {i < STEP_LABELS.length - 1 && <div className={cn("h-px w-full", i < step ? "bg-emerald-500/60" : "bg-zinc-800")} />}
            </div>
          ))}
        </div>
      </div>

      <div className="p-5">
        {step === 0 && (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label>Platform</Label>
              <div className="grid grid-cols-2 gap-2">
                {PLATFORMS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPlatform(p.id)}
                    className={cn(
                      "rounded-xl border p-3 text-left transition-all",
                      platform === p.id
                        ? "border-emerald-500/60 bg-emerald-500/10"
                        : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-600",
                    )}
                  >
                    <p className={cn("text-sm font-semibold", platform === p.id ? "text-emerald-300" : "text-zinc-200")}>
                      {p.name}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">{p.blurb}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="store-name">Store name</Label>
              <Input
                id="store-name"
                placeholder="e.g. Aurora & Oak"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="store-domain">Store domain</Label>
              <Input
                id="store-domain"
                placeholder="auroraandoak.myshopify.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-sky-500/25 bg-sky-500/[0.06] p-3.5">
              <IconWebhook className="mt-0.5 h-4.5 w-4.5 shrink-0 text-sky-400" />
              <p className="text-xs leading-relaxed text-sky-200/90">
                Create a webhook in your {PLATFORMS.find((p) => p.id === platform)?.name} admin and point it at this
                endpoint. Store Accountant verifies signatures, computes true profit, and posts journal entries
                automatically.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Webhook endpoint URL</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 font-mono text-[11px] text-emerald-300">
                  {webhookUrl}
                </code>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => navigator.clipboard?.writeText(webhookUrl)}
                >
                  Copy
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Webhook secret (optional)</Label>
              <Input placeholder="e.g. shopify_webhook_secret" />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col items-center py-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/40">
              <IconCheck className="h-6 w-6 text-emerald-400" />
            </div>
            <h4 className="mt-4 text-base font-semibold text-zinc-50">Store connected 🎉</h4>
            <p className="mt-1 max-w-xs text-xs leading-relaxed text-zinc-500">
              <span className="font-medium text-zinc-300">{name || "Your store"}</span> is now syncing. Incoming
              webhooks will be recorded, posted to the general ledger, and appear in your income statement.
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-zinc-800/70 bg-zinc-950/40 p-4">
        <Button type="button" variant="ghost" size="sm" onClick={() => (step === 0 ? onClose?.() : setStep(step - 1))}>
          {step === 0 ? "Cancel" : "Back"}
        </Button>
        {step < 2 ? (
          <Button type="button" size="sm" disabled={step === 0 && !canNext} onClick={() => setStep(step + 1)}>
            {step === 0 ? "Continue" : "Finish"}
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={onClose}>
            Done
          </Button>
        )}
      </div>
    </Card>
  );
}
