import type { Metadata } from "next";
import { Topbar } from "@/components/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { OrdersTable } from "@/components/orders-table";
import { fetchStoreOverview } from "@/lib/data/repository";

export const metadata: Metadata = { title: "Orders" };

export default async function OrdersPage() {
  const data = await fetchStoreOverview();

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <Topbar title="Orders" subtitle={`${data.orders.length} normalized orders · true profit computed per order`} />
      <div className="mx-auto w-full max-w-7xl flex-1 px-6 py-6">
        <Card>
          <CardContent className="p-5">
            <OrdersTable orders={data.orders} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
