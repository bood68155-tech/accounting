import { redirect } from "next/navigation";
import { SessionProvider } from "next-auth/react";
import { Sidebar } from "@/components/sidebar";
import { isDatabaseConfigured, requireDb, publicSchema } from "@/lib/db";
import { auth } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { getTenantContext } from "@/lib/tenants";
import { resolveSubscriptionAccess } from "@/lib/subscription/access";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The app requires a live Neon database. Show a helpful state instead of
  // crashing when credentials are missing.
  if (!isDatabaseConfigured()) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app px-6">
        <div className="max-w-md border border-white bg-black p-6 shadow-[8px_8px_0_0_#ff3b00]">
          <p className="type-kicker text-accent">System / 00</p>
          <h1 className="type-display mt-3 text-xl">Database is not configured</h1>
          <p className="mt-3 text-sm leading-relaxed text-zinc-400">
            Add{" "}
            <code className="border border-zinc-700 bg-black px-1.5 py-0.5 font-mono text-xs text-accent">
              DATABASE_URL
            </code>{" "}
            (your Neon pooled connection string) to{" "}
            <code className="border border-zinc-700 bg-black px-1.5 py-0.5 font-mono text-xs text-accent">
              .env.local
            </code>
            , run <code className="border border-zinc-700 bg-black px-1.5 py-0.5 font-mono text-xs text-accent">npm run db:migrate</code>,
            then restart the dev server.
          </p>
        </div>
      </div>
    );
  }

  const session = await auth();
  if (!session?.user) redirect("/login");

  // ─── Subscription gate ───────────────────────────────────────────────────────
  // After the 30-day trial expires (or a cancelled/past-due subscription), send
  // the account to the self-serve renewal page until the admin approves payment.
  // Admins and legacy accounts without a subscription record are always allowed.
  const access = await resolveSubscriptionAccess(session.user.id, session.user.email);
  if (!access.allowed) redirect("/renew");

  const { tenantId } = await getTenantContext();
  let tenantName = "Workspace";
  if (tenantId) {
    const { tenants } = publicSchema;
    const rows = await requireDb()
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    tenantName = rows[0]?.name ?? "Workspace";
  }

  return (
    <SessionProvider session={session}>
      <div className="flex min-h-screen flex-col bg-app md:flex-row">
        <Sidebar tenantName={tenantName} isAdmin={session.user.isAdmin === true} />
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </SessionProvider>
  );
}
