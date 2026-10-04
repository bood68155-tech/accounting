/**
 * Behavioural verification of the two guarantees the digest depends on:
 *
 *   1. The UNIQUE constraint actually rejects a duplicate delivery row — this,
 *      not the runner's pre-check, is what stops a double-send.
 *   2. A brand-new tenant provisioned through create_tenant_schema_guarded()
 *      comes out with both digest tables.
 *
 * Everything runs inside a transaction that is rolled back, so the database is
 * left exactly as it was found. No tenant is created and no row survives.
 */
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const client = new Client({ connectionString: url });
await client.connect();

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`  [${ok ? "ok" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

try {
  // ── 1 & 2. Provision a throwaway tenant, then exercise both guarantees ───
  // Using a real tenant here would skip whenever no store exists yet, so the
  // test builds its own schema (and rolls it back) to always be meaningful.
  await client.query("begin");
  try {
    const testId = "00000000-0000-4000-8000-000000000002";
    const created = await client.query(
      `select public.create_tenant_schema_guarded($1::uuid) as s`,
      [testId],
    );
    const name = created.rows[0].s;
    console.log(`  (throwaway tenant schema: ${name})`);

    // New tenants must be born with both digest tables.
    const t = await client.query(
      `select table_name from information_schema.tables
       where table_schema = $1 and table_name in ('digest_settings','digest_deliveries')`,
      [name],
    );
    const found = t.rows.map((r) => r.table_name);
    check("new tenant schema is born with both digest tables", found.length === 2, found.join(","));

    // Seed just enough to satisfy the store FK, so the constraint is exercised.
    const email = `digest-verify-${Date.now()}@example.invalid`;
    const user = await client.query(
      `insert into public.users (email, password_hash, email_verified)
       values ($1, 'x', now()) returning id`,
      [email],
    );
    // Inserting a store fires the register_store() trigger, which writes to
    // public.store_registry and therefore needs a public.tenants row first.
    await client.query(
      `insert into public.tenants (id, owner_id, name, slug, schema_name)
       values ($1::uuid, $2::uuid, 'Verify Tenant', $3, $4)`,
      [testId, user.rows[0].id, `verify-${Date.now()}`, name],
    );

    const store = await client.query(
      `insert into ${name}.stores (user_id, name, platform, currency)
       values ($1, 'Verify Store', 'custom', 'USD') returning id`,
      [user.rows[0].id],
    );
    const storeId = store.rows[0].id;

    const insert = (dest) =>
      client.query(
        `insert into ${name}.digest_deliveries
           (store_id, digest_date, channel, destination, status, attempts)
         values ($1, date '2026-03-01', 'telegram', $2, 'sent', 1)`,
        [storeId, dest],
      );

    // Each probe below runs inside its own savepoint. An expected constraint
    // violation aborts the entire transaction otherwise, and every later
    // statement then fails with 25P02 regardless of the real schema.

    // 1. A normal send inserts.
    await insert("1001");
    check("first delivery row inserts", true);

    // 2. The same store/date/channel/destination is REJECTED (23505).
    let dupCode = null;
    await client.query("savepoint probe");
    try {
      await insert("1001");
    } catch (e) {
      dupCode = e.code;
    }
    await client.query("rollback to savepoint probe");
    check("duplicate (store, date, channel, destination) is rejected", dupCode === "23505", `got ${dupCode}`);

    // 3. A different destination on the same day is legitimate.
    let otherDest = null;
    await client.query("savepoint probe");
    try {
      await insert("1002");
    } catch (e) {
      otherDest = `${e.code}: ${e.message}`.slice(0, 100);
    }
    await client.query("rollback to savepoint probe");
    check("a different destination on the same day is allowed", otherDest === null, otherDest ?? "");

    // 4. The same destination on a different day (yesterday vs today) is fine.
    let otherDay = null;
    await client.query("savepoint probe");
    try {
      await client.query(
        `insert into ${name}.digest_deliveries
           (store_id, digest_date, channel, destination, status, attempts)
         values ($1, date '2026-03-02', 'telegram', '1001', 'sent', 1)`,
        [storeId],
      );
    } catch (e) {
      otherDay = `${e.code}: ${e.message}`.slice(0, 100);
    }
    await client.query("rollback to savepoint probe");
    check("the same destination on a different day is allowed", otherDay === null, otherDay ?? "");
  } finally {
    // Nothing above survives — the throwaway schema and user disappear.
    await client.query("rollback");
  }
} finally {
  await client.end();
}

if (failures.length > 0) {
  console.error(`\nFAILED: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nAll digest guarantees hold. OK");
