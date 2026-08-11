"use server";

import { revalidatePath } from "next/cache";
import { isSupabaseConfigured } from "@/lib/data/config";
import { createClient } from "@/lib/supabase/server";

// ─── Product management actions ───────────────────────────────────────────────
// Server actions for adding, updating, and deleting products.
// In demo mode, actions are no-ops (demo data is read-only).

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
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Demo mode — products are read-only." };
  }

  try {
    const supabase = await createClient();

    // Verify the store belongs to the current user.
    const { data: store } = await supabase
      .from("stores")
      .select("id")
      .eq("id", storeId)
      .single();

    if (!store) {
      return { ok: false, error: "Store not found." };
    }

    // Check for duplicate SKU within the store.
    const { data: existing } = await supabase
      .from("products")
      .select("id")
      .eq("store_id", storeId)
      .eq("sku", formData.sku)
      .single();

    if (existing) {
      return { ok: false, error: `A product with SKU "${formData.sku}" already exists.` };
    }

    const { error } = await supabase.from("products").insert({
      store_id: storeId,
      sku: formData.sku,
      name: formData.name,
      unit_cost: formData.unit_cost,
      unit_price: formData.unit_price,
      external_id: formData.external_id ?? null,
    });

    if (error) throw new Error(error.message);

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
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Demo mode — products are read-only." };
  }

  try {
    const supabase = await createClient();

    const { error } = await supabase
      .from("products")
      .update({
        sku: formData.sku,
        name: formData.name,
        unit_cost: formData.unit_cost,
        unit_price: formData.unit_price,
        external_id: formData.external_id ?? null,
      })
      .eq("id", productId)
      .eq("store_id", storeId);

    if (error) throw new Error(error.message);

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
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Demo mode — products are read-only." };
  }

  try {
    const supabase = await createClient();

    const { error } = await supabase
      .from("products")
      .delete()
      .eq("id", productId)
      .eq("store_id", storeId);

    if (error) throw new Error(error.message);

    revalidatePath(`/stores/${storeId}`);
    revalidatePath(`/stores/${storeId}/products`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to delete product." };
  }
}
