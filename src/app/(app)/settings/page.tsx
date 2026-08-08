import type { Metadata } from "next";
import { Topbar } from "@/components/topbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { IconShield } from "@/components/icons";
import { isSupabaseConfigured } from "@/lib/data/config";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  const live = isSupabaseConfigured();

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <Topbar title="Settings" subtitle="Workspace, accounting defaults and security" />
      <div className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-6 py-6">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Your account details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Full name</Label>
                <Input defaultValue="Aurora Owner" />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" defaultValue="owner@auroraandoak.com" />
              </div>
            </div>
            <div className="flex justify-end">
              <Button variant="secondary" size="sm">Save changes</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Accounting defaults</CardTitle>
            <CardDescription>Applied to new stores and incoming orders</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Default currency</Label>
                <Select defaultValue="USD">
                  <option value="USD">USD — US Dollar</option>
                  <option value="EUR">EUR — Euro</option>
                  <option value="GBP">GBP — British Pound</option>
                  <option value="CAD">CAD — Canadian Dollar</option>
                  <option value="AUD">AUD — Australian Dollar</option>
                  <option value="SAR">SAR — Saudi Riyal</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Cost basis</Label>
                <Select defaultValue="webhook">
                  <option value="webhook">From webhook payload</option>
                  <option value="product">From product catalog</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Default shipping cost (per order)</Label>
                <Input type="number" step="0.01" defaultValue="4.50" />
              </div>
              <div className="space-y-1.5">
                <Label>Fiscal year start</Label>
                <Select defaultValue="jan">
                  <option value="jan">January</option>
                  <option value="apr">April</option>
                  <option value="jul">July</option>
                  <option value="oct">October</option>
                </Select>
              </div>
            </div>
            <div className="flex justify-end">
              <Button variant="secondary" size="sm">Save defaults</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Webhook security</CardTitle>
              <CardDescription>Signature verification for incoming events</CardDescription>
            </div>
            <IconShield className="h-4.5 w-4.5 text-emerald-400" />
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            {[
              { label: "Shopify webhook secret", value: live ? "••••••••••••••••" : "set SHOPIFY_WEBHOOK_SECRET" },
              { label: "Stripe webhook secret", value: live ? "whsec_••••••••••••" : "set STRIPE_WEBHOOK_SECRET" },
              { label: "PayPal webhook ID", value: live ? "••••••••••••" : "set PAYPAL_WEBHOOK_ID" },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
                <span className="text-sm text-zinc-300">{row.label}</span>
                <div className="flex items-center gap-2">
                  <Badge variant={live ? "success" : "warning"}>{live ? "Configured" : "Env var required"}</Badge>
                  <code className="font-mono text-[11px] text-zinc-500">{row.value}</code>
                </div>
              </div>
            ))}
            <p className="text-xs leading-relaxed text-zinc-500">
              Secrets live in your environment variables — they are never stored in the database or sent to the browser.
            </p>
          </CardContent>
        </Card>

        <Card className="border-red-500/25">
          <CardHeader>
            <CardTitle className="text-red-400">Danger zone</CardTitle>
            <CardDescription>Destructive actions for this workspace</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4 pt-4">
            <p className="text-xs text-zinc-500">Permanently delete all bookkeeping data for this workspace.</p>
            <Button variant="danger" size="sm">Delete workspace</Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
