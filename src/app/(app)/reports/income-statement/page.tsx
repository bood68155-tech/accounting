import type { Metadata } from "next";
import { Topbar } from "@/components/topbar";
import { IncomeStatementView } from "@/components/income-statement-view";
import { fetchStoreOverview } from "@/lib/data/repository";

export const metadata: Metadata = { title: "Income Statement" };

export default async function IncomeStatementPage() {
  const data = await fetchStoreOverview();

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <Topbar
        title="Income Statement"
        subtitle="Revenue, COGS and operating expenses — derived from your general ledger"
      />
      <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-6">
        <IncomeStatementView orders={data.orders} currency={data.store?.currency ?? "USD"} />
      </div>
    </main>
  );
}
