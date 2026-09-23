"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IconCheck, IconStore, IconWebhook } from "@/components/icons";
import { cn } from "@/lib/utils";

type Platform = "shopify" | "salla" | "woocommerce" | "stripe" | "paypal";

const PLATFORMS: Array<{ id: Platform; name: string; blurb: string }> = [
  { id: "shopify", name: "Shopify", blurb: "Orders, refunds & Shopify Payments fees" },
  { id: "salla", name: "Salla", blurb: "Salla orders via webhooks (SAR)" },
  { id: "woocommerce", name: "WooCommerce", blurb: "WordPress store orders" },
  { id: "stripe", name: "Stripe", blurb: "Payment gateway fees & payouts" },
  { id: "paypal", name: "PayPal", blurb: "Checkout orders & transaction fees" },
];

const STEP_LABELS = ["Store details", "Webhook endpoint"];

interface ConnectedStore {
  id: string;
  name: string;
  platform: Platform;
  domain: string | null;
  status: string;
}

export function StoreConnect({ onClose }: { onClose?: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [platform, setPlatform] = useState<Platform>("shopify");
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [store, setStore] = useState<ConnectedStore | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const webhookUrl = store && origin ? `${origin}/api/webhooks/${store.platform}?store_id=${store.id}` : "";

  const canContinue = step === 0 && name.trim().length > 0 && !saving;

  async function saveStore(): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), platform, domain: domain.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        store?: ConnectedStore;
      };
      if (!res.ok || !data.store) {
        setError(data.error ?? "Could not connect the store. Please try again.");
        setSaving(false);
        return false;
      }
      setStore(data.store);
      setSaving(false);
      return true;
    } catch {
      setError("Network error — please try again.");
      setSaving(false);
      return false;
    }
  }

  async function handleContinue() {
    if (step === 0) {
      const ok = await saveStore();
      if (ok) setStep(1);
    }
    // Step 1's primary action is Finish — see handleFinish.
  }

  /**
   * Finish (webhook step): make sure the store is persisted (it normally
   * already is from step 0 — this covers any edge where state was lost),
   * then return to the stores list, refreshed so the new store shows up.
   */
  async function handleFinish() {
    setError(null);
    if (!store) {
      const ok = await saveStore();
      if (!ok) return;
    }
    onClose?.();
    router.push("/stores");
    router.refresh();
  }

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

            {error && (
              <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-sky-500/25 bg-sky-500/[0.06] p-3.5">
              <IconWebhook className="mt-0.5 h-4.5 w-4.5 shrink-0 text-sky-400" />
              <p className="text-xs leading-relaxed text-sky-200/90">
                Create a webhook in your {PLATFORMS.find((p) => p.id === platform)?.name} admin and point it at this
                endpoint (the store id is already included). Signature verification is handled server-side via the
                platform&apos;s webhook secret (e.g. <code className="font-mono">SHOPIFY_WEBHOOK_SECRET</code>,{" "}
                <code className="font-mono">SALLA_WEBHOOK_SECRET</code>).
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Webhook endpoint URL</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 font-mono text-[11px] text-emerald-300">
                  {webhookUrl || "…"}
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
              <p className="text-[11px] text-zinc-500">
                Subscribe to <span className="font-medium text-zinc-300">Order creation</span> (and optionally refunds)
                for the books to update automatically.
              </p>
            </div>

            {error && (
              <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>
            )}

            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3">
              <IconCheck className="h-4 w-4 shrink-0 text-emerald-400" />
              <p className="text-xs text-emerald-200/90">
                <span className="font-medium">{store?.name ?? name}</span> is saved — Finish returns you to your stores
                list. You can copy this URL and finish the platform setup any time.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-zinc-800/70 bg-zinc-950/40 p-4">
        <Button type="button" variant="ghost" size="sm" onClick={() => (step === 0 ? onClose?.() : setStep(step - 1))}>
          {step === 0 ? "Cancel" : "Back"}
        </Button>
        {step === 0 ? (
          <Button type="button" size="sm" disabled={!canContinue} onClick={handleContinue}>
            {saving ? "Saving…" : "Continue"}
          </Button>
        ) : (
          <Button type="button" size="sm" disabled={saving} onClick={handleFinish}>
            {saving ? "Saving…" : "Finish"}
          </Button>
        )}
      </div>
    </Card>
  );
}
