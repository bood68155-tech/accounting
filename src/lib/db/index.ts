/**
 * ── Database layer (Drizzle ORM + Neon) ───────────────────────────────────────
 * Drizzle clients over the Neon HTTP driver. Stateless and pooled — ideal for
 * serverless (no connection state to maintain between invocations).
 *
 * Two views of the same database:
 *   • `requireDb()`       — the public schema (users, tenants, store_registry…)
 *   • `tenantDb(schema)`  — a Drizzle instance bound to one tenant's Postgres
 *     schema (`tenant_<uuid-hex>`), with the tenant tables attached so queries
 *     are fully typed. Instances are memoized per schema.
 *
 * Clients are created lazily so importing this module never throws (builds and
 * page-data collection run without DATABASE_URL present).
 */
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as publicSchema from "./schema";
import { getTenantTables, TENANT_SCHEMA_RE } from "./tenant";

export type PublicDb = ReturnType<typeof makePublicDb>;
export type TenantDb = ReturnType<typeof makeTenantDb>;

function makePublicDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not configured — add your Neon connection string to the environment.",
    );
  }
  return drizzle(neon(process.env.DATABASE_URL), { schema: publicSchema });
}

function makeTenantDb(schema: string) {
  return drizzle(neon(process.env.DATABASE_URL!), {
    schema: getTenantTables(schema),
  });
}

/** True when the app has a Neon connection string in the environment. */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/** True when the string looks like a tenant schema (tenant_<32 hex chars>). */
export function isTenantSchema(schema: string | null | undefined): boolean {
  return Boolean(schema && TENANT_SCHEMA_RE.test(schema));
}

let cachedPublicDb: PublicDb | null = null;

/** The public-schema Drizzle client (memoized). Throws without DATABASE_URL. */
export function requireDb(): PublicDb {
  if (!cachedPublicDb) cachedPublicDb = makePublicDb();
  return cachedPublicDb;
}

const tenantDbCache = new Map<string, TenantDb>();

/**
 * The tenant-schema Drizzle client for one tenant schema name (memoized).
 * Prefer this in data-access code; all tenant reads/writes must go through it.
 * Throws on a schema name that does not match `tenant_<32 hex chars>`.
 */
export function tenantDb(schema: string): TenantDb {
  if (!TENANT_SCHEMA_RE.test(schema)) {
    throw new Error(`Invalid tenant schema name: ${JSON.stringify(schema)}`);
  }
  let db = tenantDbCache.get(schema);
  if (!db) {
    db = makeTenantDb(schema);
    tenantDbCache.set(schema, db);
  }
  return db;
}

export { publicSchema };
export { getTenantTables, TENANT_SCHEMA_RE };
