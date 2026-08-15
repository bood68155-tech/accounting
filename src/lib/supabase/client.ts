"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabasePublishableKey } from "@/lib/supabase/env";

/**
 * Browser-side Supabase client (used in client components).
 *
 * In the multi-tenant architecture every request is scoped to the user's
 * tenant schema (`db.schema`). Pass the schema name (from the `tenant-schema`
 * cookie, resolved by middleware) when querying tenant data; omit it to talk
 * to the shared `public` schema (auth, tenants metadata).
 */
export function createClient(schema?: string) {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabasePublishableKey!,
    schema ? { db: { schema } } : undefined,
  );
}
