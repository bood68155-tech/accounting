import { auth } from "@/lib/auth";
import { isTenantSchema } from "@/lib/db";

// ─── Tenant context (schema-per-tenant isolation) ─────────────────────────────
// Every signed-in user belongs to a tenant, and each tenant owns a dedicated
// Postgres schema (`tenant_<uuid-hex>`). The tenant is resolved at login and
// embedded in the NextAuth JWT; server code reads it here to scope every query
// to the right schema. Unlike the previous cookie-based approach, the tenant
// cannot be spoofed — it is cryptographically bound to the session.

export interface TenantContext {
  tenantId: string | null;
  schema: string | null;
}

/**
 * The signed-in user's tenant context. Reads come from the verified JWT —
 * never from client-controlled input. Returns nulls when signed out or when
 * the account has no tenant provisioned yet.
 */
export async function getTenantContext(): Promise<TenantContext> {
  const session = await auth();
  const tenantId = session?.user?.tenantId ?? null;
  const schema = session?.user?.tenantSchema ?? null;

  // Defense in depth: ignore any schema value that doesn't match the
  // tenant_<32-hex> shape, so a stale/corrupt token can never select an
  // arbitrary schema.
  return {
    tenantId: tenantId ?? null,
    schema: isTenantSchema(schema) ? schema : null,
  };
}

/** The Postgres schema holding the signed-in user's tenant data, if any. */
export async function getTenantSchema(): Promise<string | null> {
  return (await getTenantContext()).schema;
}
