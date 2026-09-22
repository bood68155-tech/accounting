import type { Metadata } from "next";
import { Topbar } from "@/components/topbar";
import { BalanceSheetView } from "@/components/balance-sheet-view";
import { fetchLedger } from "@/lib/data/repository";

export const metadata: Metadata = { title: "Balance Sheet" };

export default async function BalanceSheetPage() {
  const entries = await fetchLedger();

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <Topbar
        title="Balance Sheet"
        subtitle="Assets, liabilities & equity — derived from your general ledger as of any date"
      />
      <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-6">
        <BalanceSheetView entries={entries} currency="USD" />
      </div>
    </main>
  );
}
