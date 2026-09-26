import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * ── /api/sync/products (alias of /api/products/sync) ──────────────────────────
 * Kept so integrations/docs that use the "sync/<resource>" URL shape keep
 * working. Identical scope-graceful behavior: per-store results with
 * `needsScopeGrant` (missing Shopify scopes surfaced clearly) and a one-shot
 * auto-retry via `retryAfterScopeGrant: true`. Re-declared literally rather
 * than re-exported because Next.js statically parses route segment config.
 */
export async function POST(request: NextRequest) {
  const { POST: handler } = await import("@/app/api/products/sync/route");
  return handler(request);
}
