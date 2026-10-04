import { Client } from "pg";

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`  [${ok ? "ok" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

// 1. public.telegram_link_tokens exists with the expected uniqueness.
const tok = await client.query(`
  select column_name from information_schema.columns
  where table_schema='public' and table_name='telegram_link_tokens'`);
const tokCols = tok.rows.map((r) => r.column_name);
check("public.telegram_link_tokens exists", tokCols.length > 0, tokCols.join(","));

const idx = await client.query(`
  select indexdef from pg_indexes
  where schemaname='public' and tablename='telegram_link_tokens'`);
check(
  "one live token per store (unique index)",
  idx.rows.some((r) => r.indexdef.includes("UNIQUE") && r.indexdef.includes("store_id")),
);

// 2. Every tenant schema carries the binding columns.
const schemas = await client.query(`
  select table_schema from information_schema.tables
  where table_schema like 'tenant\\_%' escape '\\' group by table_schema order by table_schema`);
console.log(`  tenant schemas: ${schemas.rows.length}`);

const WANT = [
  "telegram_chat_id",
  "telegram_chat_title",
  "telegram_username",
  "telegram_linked_at",
  "telegram_bot_username",
];

for (const { table_schema: s } of schemas.rows) {
  const cols = await client.query(
    `select column_name from information_schema.columns
     where table_schema = $1 and table_name = 'digest_settings'`,
    [s],
  );
  const have = cols.rows.map((r) => r.column_name);
  const missing = WANT.filter((c) => !have.includes(c));
  check(`${s} binding columns`, missing.length === 0, missing.length ? `missing ${missing.join(",")}` : "all present");
}

// 3. New tenants are provisioned with the columns.
await client.query("begin");
try {
  const made = await client.query(`select public.create_tenant_schema_guarded($1::uuid) as s`, [
    "00000000-0000-4000-8000-000000000003",
  ]);
  const name = made.rows[0].s;
  const cols = await client.query(
    `select column_name from information_schema.columns
     where table_schema = $1 and table_name = 'digest_settings' and column_name like 'telegram_%'`,
    [name],
  );
  check(
    "new tenant is born with the telegram binding columns",
    cols.rows.length === WANT.length,
    `${cols.rows.length}/${WANT.length}`,
  );
} finally {
  await client.query("rollback");
}

await client.end();

if (failures.length) {
  console.error(`\nFAILED: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nTelegram binding schema verified. OK");
