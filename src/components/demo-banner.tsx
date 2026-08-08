import { IconDatabase } from "@/components/icons";

export function DemoBanner() {
  return (
    <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3">
      <IconDatabase className="mt-0.5 h-4.5 w-4.5 shrink-0 text-amber-400" />
      <div className="text-xs leading-relaxed text-amber-200/90">
        <span className="font-semibold text-amber-300">Demo mode — </span>
        you&apos;re exploring Store Accountant with sample data. Add your Supabase credentials in{" "}
        <code className="rounded bg-amber-500/10 px-1 py-0.5 font-mono text-[11px] text-amber-300">
          .env.local
        </code>{" "}
        and run the SQL migration to connect real stores.
      </div>
    </div>
  );
}
