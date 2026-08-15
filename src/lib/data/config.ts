import { supabasePublishableKey } from "@/lib/supabase/env";

/** True when the app has working Supabase credentials in the environment. */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && supabasePublishableKey,
  );
}
