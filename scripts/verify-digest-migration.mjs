/**
 * Post-migration verification: confirm the daily-digest tables, the idempotency
 * UNIQUE constraint, and the provisioning function really exist in the live
 * database — not just that the migration script exited 0.
 *
 * Run with: node --env-file-if-exists=.env.local scripts/verify-digest-migration.mjs
 */
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const client = new Client({ connectionString: url });
await client.connect();

const tenantSchemas = await client.query(`
  select table_schema as schema_name
  from information_schema.tables
  where table_schema like 'tenant\\_%' escape '\\'
  group by schema_name
  order by schema_name
`);

console.log(`tenant schemas found: ${tenantSchemas.rows.length}`);

const failures = [];

for (const { schema_name: schema } of tenantSchemas.rows) {
  const tables = await client.query(
    `select table_name from information_schema.tables
     where table_schema = $1 and table_name in ('digest_settings','digest_deliveries')
     order by table_name`,
    [schema],
  );
  const found = tables.rows.map((r) => r.table_name);
  const missing = ["digest_deliveries", "digest_settings"].filter((t) => !found.includes(t));

  // The idempotency guarantee must be a real UNIQUE constraint, not just a comment.
  const constraints = await client.query(
    `select conname, pg_get_constraintdef(oid) as def
     from pg_constraint
     where conrelid = format('%I.digest_deliveries', $1::text)::regclass`,
    [schema],
  );
  const hasUnique = constraints.rows.some(
    (c) => (c.def ?? "").toUpperCase().includes("UNIQUE") && c.def.includes("digest_date"),
  );

  const status = missing.length === 0 && hasUnique ? "ok" : "FAIL";
  if (status === "FAIL") failures.push({ schema, missing, hasUnique });

  console.log(
    `  [${status}] ${schema}  tables=${found.join(",") || "none"}  unique_constraint=${hasUnique}`,
  );
}

// New tenants must be provisioned with these tables too.
const fn = await client.query(`
  select prosrc ~ 'digest_settings' and prosrc ~ 'digest_deliveries' as wired
  from pg_proc where proname = 'create_tenant_schema_guarded'
`);
const fnWired = fn.rows[0]?.wired === true;
if (!fnWired) failures.push({ schema: "public", reason: "create_tenant_schema_guarded not wired" });
console.log(`  create_tenant_schema_guarded provisions digest tables: ${fnWired}`);

// Confirm the migration is recorded as applied (idempotent re-runs).
const applied = await client.query(
  `select name from public._migrations where name = '20261004000000_daily_digest.sql'`,
);
console.log(`  recorded in public._migrations: ${applied.rows.length === 1}`);

await client.end();

if (failures.length > 0) {
  console.error("\nVERIFICATION FAILED:", JSON.stringify(failures, null, 2));
  process.exit(1);
}
console.log("\nAll digest tables present with the idempotency constraint. OK");
