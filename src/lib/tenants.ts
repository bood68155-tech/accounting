import { cookies } from "next/headers";

// ─── Tenant context (schema-per-tenant isolation) ─────────────────────────────
// Every signed-in user belongs to a tenant, and each tenant owns a dedicated
// Postgres schema (`tenant_<uuid-hex>`). The middleware resolves the user's
// tenant after login and stores the tenant id + schema name in cookies; server
// code reads them here to scope every query to the right schema.

/** Cookie holding the current tenant id (plain — safe, non-sensitive). */
export const TENANT_ID_COOKIE = "tenant-id";
/** Cookie holding the current tenant's Postgres schema name. */
export const TENANT_SCHEMA_COOKIE = "tenant-schema";

export interface TenantContext {
  tenantId: string | null;
  schema: string | null;
}

export async function getTenantContext(): Promise<TenantContext> {
  const store = await cookies();
  return {
    tenantId: store.get(TENANT_ID_COOKIE)?.value ?? null,
    schema: store.get(TENANT_SCHEMA_COOKIE)?.value ?? null,
  };
}

/** The Postgres schema holding the signed-in user's tenant data, if any. */
export async function getTenantSchema(): Promise<string | null> {
  return (await getTenantContext()).schema;
}
