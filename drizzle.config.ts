import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit points at the PUBLIC schema only (users, tenants, store_registry…).
 * Per-tenant schemas are provisioned dynamically by
 * public.create_tenant_schema() in db/migrations and are intentionally NOT
 * managed by drizzle-kit (they are runtime-built in src/lib/db/tenant.ts).
 *
 * Schema changes should go through db/migrations/*.sql + `npm run db:migrate`;
 * this config exists for `drizzle-kit studio` and ad-hoc introspection.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./db/drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  verbose: true,
  strict: true,
});
