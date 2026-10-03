import type { Metadata } from "next";
import { Topbar } from "@/components/topbar";
import { FinancialHealthView } from "@/components/financial-health-view";
import { fetchLedger, fetchStoreOverview } from "@/lib/data/repository";

export const metadata: Metadata = { title: "Financial Health" };

export default async function FinancialHealthPage() {
  const [entries, overview] = await Promise.all([fetchLedger(), fetchStoreOverview()]);

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <Topbar
        title="Financial Health"
        subtitle="Financial ratios, statement of cash flows and trial balance — derived from your general ledger"
      />
      <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
        <FinancialHealthView entries={entries} currency={overview.store?.currency ?? "USD"} />
      </div>
    </main>
  );
}
