"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getTenantSchema } from "@/lib/tenants";
import { tenantDb, getTenantTables } from "@/lib/db";

// ─── Product management actions ───────────────────────────────────────────────
// Server actions for adding, updating, and deleting products. All queries run
// against the signed-in user's tenant schema (schema-per-tenant isolation,
// resolved from the NextAuth session).

export type ProductFormData = {
  sku: string;
  name: string;
  unit_cost: number;
  unit_price: number;
  external_id?: string;
};

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Add a new product to a store. */
export async function addProduct(
  storeId: string,
  formData: ProductFormData,
): Promise<ActionResult> {
  const schema = await getTenantSchema();
  if (!schema) return { ok: false, error: "No tenant context — sign in and try again." };

  try {
    const db = tenantDb(schema);
    const t = getTenantTables(schema);

    // Verify the store belongs to the tenant's schema.
    const store = await db
      .select({ id: t.stores.id })
      .from(t.stores)
      .where(eq(t.stores.id, storeId))
      .limit(1);
    if (store.length === 0) {
      return { ok: false, error: "Store not found." };
    }

    // Check for duplicate SKU within the store.
    const existing = await db
      .select({ id: t.products.id })
      .from(t.products)
      .where(and(eq(t.products.storeId, storeId), eq(t.products.sku, formData.sku)))
      .limit(1);
    if (existing.length > 0) {
      return { ok: false, error: `A product with SKU "${formData.sku}" already exists.` };
    }

    await db.insert(t.products).values({
      storeId,
      sku: formData.sku,
      name: formData.name,
      unitCost: formData.unit_cost,
      unitPrice: formData.unit_price,
      externalId: formData.external_id ?? null,
    });

    revalidatePath(`/stores/${storeId}`);
    revalidatePath(`/stores/${storeId}/products`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to add product." };
  }
}

/** Update an existing product. */
export async function updateProduct(
  storeId: string,
  productId: string,
  formData: ProductFormData,
): Promise<ActionResult> {
  const schema = await getTenantSchema();
  if (!schema) return { ok: false, error: "No tenant context — sign in and try again." };

  try {
    const db = tenantDb(schema);
    const t = getTenantTables(schema);

    await db
      .update(t.products)
      .set({
        sku: formData.sku,
        name: formData.name,
        unitCost: formData.unit_cost,
        unitPrice: formData.unit_price,
        externalId: formData.external_id ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(t.products.id, productId), eq(t.products.storeId, storeId)));

    revalidatePath(`/stores/${storeId}`);
    revalidatePath(`/stores/${storeId}/products`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update product." };
  }
}

/** Delete a product. */
export async function deleteProduct(
  storeId: string,
  productId: string,
): Promise<ActionResult> {
  const schema = await getTenantSchema();
  if (!schema) return { ok: false, error: "No tenant context — sign in and try again." };

  try {
    const db = tenantDb(schema);
    const t = getTenantTables(schema);

    await db
      .delete(t.products)
      .where(and(eq(t.products.id, productId), eq(t.products.storeId, storeId)));

    revalidatePath(`/stores/${storeId}`);
    revalidatePath(`/stores/${storeId}/products`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to delete product." };
  }
}
