import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for API routes, webhooks and admin only.
 * Bypasses RLS — NEVER import this from client components or server components
 * that render user data. Guarded by SUPABASE_SERVICE_ROLE_KEY.
 *
 * Pass the tenant schema name to write/read inside a tenant's schema (webhook
 * ingestion, admin aggregation); omit it for the shared `public` schema.
 */
export function createAdminClient(schema?: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: schema ? { schema } : undefined,
  });
}

export function hasAdminCredentials(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}
