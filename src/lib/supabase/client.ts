"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabasePublishableKey } from "@/lib/supabase/env";

/** Browser-side Supabase client (used in client components). */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabasePublishableKey!,
  );
}
