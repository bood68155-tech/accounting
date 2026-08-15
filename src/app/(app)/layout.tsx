import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { isSupabaseConfigured } from "@/lib/data/config";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenants";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The app requires a live Supabase project. Show a helpful state instead of
  // crashing when credentials are missing.
  if (!isSupabaseConfigured()) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0d10] px-6">
        <div className="max-w-md rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-6 text-center">
          <h1 className="text-base font-semibold text-zinc-50">Supabase is not configured</h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            Add <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-xs text-emerald-300">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
            and <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-xs text-emerald-300">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>{" "}
            to <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-xs text-emerald-300">.env.local</code>,
            run the migrations, then restart the dev server.
          </p>
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { tenantId } = await getTenantContext();
  let tenantName = "Workspace";
  if (tenantId) {
    const { data } = await supabase
      .from("tenants")
      .select("name")
      .eq("id", tenantId)
      .maybeSingle();
    tenantName = data?.name ?? "Workspace";
  }

  return (
    <div className="flex min-h-screen bg-[#0b0d10]">
      <Sidebar tenantName={tenantName} />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
