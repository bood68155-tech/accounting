import type { Metadata } from "next";
import { Topbar } from "@/components/topbar";
import { ProductsAdmin } from "@/components/products-admin";
import { fetchAllProducts } from "@/lib/data/repository";

export const metadata: Metadata = { title: "Products" };

export default async function ProductsPage() {
  const products = await fetchAllProducts();

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <Topbar
        title="Products"
        subtitle="Catalog cost prices drive true COGS on every incoming order"
      />
      <div className="mx-auto w-full max-w-7xl flex-1 px-6 py-6">
        <ProductsAdmin products={products} />
      </div>
    </main>
  );
}
