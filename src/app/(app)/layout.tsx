import { redirect } from "next/navigation";
import { SessionProvider } from "next-auth/react";
import { Sidebar } from "@/components/sidebar";
import { isDatabaseConfigured, requireDb, publicSchema } from "@/lib/db";
import { auth } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { getTenantContext } from "@/lib/tenants";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The app requires a live Neon database. Show a helpful state instead of
  // crashing when credentials are missing.
  if (!isDatabaseConfigured()) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0d10] px-6">
        <div className="max-w-md rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-6 text-center">
          <h1 className="text-base font-semibold text-zinc-50">Database is not configured</h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            Add{" "}
            <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-xs text-emerald-300">
              DATABASE_URL
            </code>{" "}
            (your Neon pooled connection string) to{" "}
            <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-xs text-emerald-300">
              .env.local
            </code>
            , run <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-xs text-emerald-300">npm run db:migrate</code>,
            then restart the dev server.
          </p>
        </div>
      </div>
    );
  }

  const session = await auth();
  if (!session?.user) redirect("/login");

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
      <div className="flex min-h-screen bg-[#0b0d10]">
        <Sidebar tenantName={tenantName} />
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </SessionProvider>
  );
}
