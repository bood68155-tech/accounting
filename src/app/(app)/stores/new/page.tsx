import type { Metadata } from "next";
import { Topbar } from "@/components/topbar";
import { StoreConnect } from "@/components/store-connect";

export const metadata: Metadata = { title: "Connect a store" };

export default function NewStorePage() {
  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <Topbar title="Connect a store" subtitle="Webhook-based integration — no complex API sync required" />
      <div className="mx-auto flex w-full max-w-lg flex-1 px-6 py-8">
        <StoreConnect />
      </div>
    </main>
  );
}
