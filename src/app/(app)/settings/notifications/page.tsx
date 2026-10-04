import type { Metadata } from "next";
import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { TelegramConnectCard } from "@/components/telegram-connect-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { getTenantContext } from "@/lib/tenants";
import { getTenantTables, isDatabaseConfigured, tenantDb } from "@/lib/db";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

/**
 * /settings/notifications — per-store notification connections.
 *
 * The binding is per STORE, not per tenant: an owner with three shops connects
 * a Telegram chat to each one separately, which is why this page renders one
 * card per store instead of a single global toggle.
 */
export default async function NotificationsSettingsPage() {
  const stores = await loadStores();

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <Topbar title="Notifications" subtitle="Daily digest delivery for each store" />
      <div className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-6 py-6">
        {stores.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No stores yet</CardTitle>
              <CardDescription>Connect a store before setting up notifications.</CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href="/stores"
                className="text-sm text-white underline underline-offset-4 hover:opacity-70"
              >
                Go to Stores →
              </Link>
            </CardContent>
          </Card>
        ) : (
          stores.map((store) => <TelegramConnectCard key={store.id} storeId={store.id} />)
        )}
      </div>
    </main>
  );
}

async function loadStores(): Promise<Array<{ id: string; name: string }>> {
  if (!isDatabaseConfigured()) return [];

  const session = await auth();
  if (!session?.user) return [];

  const { schema } = await getTenantContext();
  if (!schema) return [];

  const t = getTenantTables(schema);
  const rows = await tenantDb(schema)
    .select({ id: t.stores.id, name: t.stores.name })
    .from(t.stores)
    .orderBy(t.stores.name);

  return rows;
}
