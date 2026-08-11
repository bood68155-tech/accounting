import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { ProductsManager } from "@/components/products-manager";
import { fetchStoreOverview } from "@/lib/data/repository";

export const metadata: Metadata = { title: "Products" };

export default async function ProductsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await fetchStoreOverview(id);
  if (!data.store) notFound();

  const store = data.store;

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <Topbar
        title={`${store.name} — Products`}
        subtitle={`Manage inventory, cost prices, and selling prices`}
        backHref={`/stores/${id}`}
      />
      <div className="mx-auto w-full max-w-7xl flex-1 px-6 py-6">
        <ProductsManager storeId={store.id} products={data.products} currency={store.currency ?? "USD"} demo={data.mode === "demo"} />
      </div>
    </main>
  );
}
