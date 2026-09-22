import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdminAccess } from "@/lib/admin/auth";
import { isDatabaseConfigured, isTenantSchema, requireDb, publicSchema, tenantDb, getTenantTables } from "@/lib/db";
import type { StoreStatus } from "@/types";

export const dynamic = "force-dynamic";

const VALID_STATUSES: StoreStatus[] = ["connected", "syncing", "disconnected"];

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const access = await requireAdminAccess();
  if (!access.granted) {
    return NextResponse.json({ error: access.message }, { status: access.status });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Writes require a live database (DATABASE_URL)." },
      { status: 400 },
    );
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { status?: string };

  if (!body.status || !VALID_STATUSES.includes(body.status as StoreStatus)) {
    return NextResponse.json({ error: "Invalid store status." }, { status: 400 });
  }

  // Find the tenant schema that owns this store via the shared registry,
  // then update the store inside its own schema.
  const { storeRegistry } = publicSchema;
  const registryRows = await requireDb()
    .select({ schemaName: storeRegistry.schemaName })
    .from(storeRegistry)
    .where(eq(storeRegistry.storeId, id))
    .limit(1);

  const schema = registryRows[0]?.schemaName;
  if (!schema || !isTenantSchema(schema)) {
    return NextResponse.json({ error: "Store not found in any tenant." }, { status: 404 });
  }

  try {
    const t = getTenantTables(schema);
    await tenantDb(schema)
      .update(t.stores)
      .set({ status: body.status as StoreStatus, updatedAt: new Date() })
      .where(eq(t.stores.id, id));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Update failed." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
