/**
 * Apply migration SQL files to the database via a direct Postgres connection.
 *
 * Reads DATABASE_URL from .env.local / environment.
 * Applies every migration in db/migrations in filename order, skipping
 * files whose name is recorded in public._migrations (applied-tracking table,
 * created on first run if missing).
 *
 * Usage:
 *   DATABASE_URL=postgres://... npm run db:migrate
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const { Client } = pg;

const url =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL;

if (!url) {
  console.error(
    "Missing DATABASE_URL — set it in .env.local or the environment, e.g.\n" +
      "  postgresql://neondb_owner:<password>@ep-<ref>-<id>.<region>.aws.neon.tech/neondb?sslmode=require"
  );
  process.exit(1);
}

const migrationsDir = join(process.cwd(), "db", "migrations");
const files = (await readdir(migrationsDir))
  .filter((f) => f.endsWith(".sql"))
  .sort();

const client = new Client({ connectionString: url });
await client.connect();

// Ensure the applied-tracking table exists.
await client.query(`
  create table if not exists public._migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  );
`);

const { rows: applied } = await client.query(
  `select name from public._migrations`
);
const appliedSet = new Set(applied.map((r) => r.name));

for (const file of files) {
  if (appliedSet.has(file)) {
    console.log(`skip  ${file} (already applied)`);
    continue;
  }
  const sql = await readFile(join(migrationsDir, file), "utf8");
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query(
      `insert into public._migrations (name) values ($1) on conflict (name) do nothing`,
      [file]
    );
    await client.query("commit");
    console.log(`ok    ${file}`);
  } catch (err) {
    await client.query("rollback");
    console.error(`FAIL  ${file}`);
    console.error(err.message);
    process.exit(1);
  }
}

await client.end();
console.log("done — migrations applied.");
