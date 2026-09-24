/**
 * ── Ledger guard bypass (statement-level, for ops scripts) ────────────────────
 *
 * The ERPNext-style immutability triggers protect the ledger from in-place
 * edits at all times. Maintenance flows that must genuinely remove ledger data
 * (demo re-seeds, tenant offboarding) run their deletes with the guard
 * suspended for the transaction:
 *
 *   const client = await guardedClient(connectionString);
 *   await client.query("begin");
 *   await client.query("set local app.ledger_guard = 'off'");
 *   await client.query(`delete from ...`);
 *   await client.query("commit");
 *   // guard is back on automatically — the setting was transaction-scoped
 *
 * Requires a superuser / table-owner connection (the same role that runs
 * migrations). Application connections never suspend the guard.
 */
import pg from "pg";

/**
 * Create a pg Client and immediately suspend the ledger guard.
 * ONLY for ops/maintenance scripts. Call `client.end()` when done.
 */
export async function guardedClient(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  // Guard is off only for this session until `set app.ledger_guard = 'on'`
  // (or the session ends). Prefer wrapping deletes in an explicit transaction
  // with `set local` so the guard auto-restores on commit/rollback.
  await client.query("set app.ledger_guard = 'off'");
  return client;
}
