import type { Metadata } from "next";
import { Topbar } from "@/components/topbar";
import { AiAssistant } from "@/components/ai-assistant";
import { fetchStoreOverview } from "@/lib/data/repository";

export const metadata: Metadata = { title: "AI Assistant" };

export default async function AssistantPage() {
  const data = await fetchStoreOverview();

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <Topbar
        title="AI Financial Assistant"
        subtitle="Natural-language insights, forecasts and ledger answers — grounded in your books"
      />
      <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-6">
        <AiAssistant storeName={data.store?.name ?? "your store"} />
      </div>
    </main>
  );
}
