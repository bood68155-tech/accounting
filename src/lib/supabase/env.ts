/**
 * Resolve the client-side Supabase key.
 *
 * Newer Supabase projects expose a publishable key (sb_publishable_...) as
 * the safe client key; older ones expose a legacy anon key (JWT eyJ...).
 * We accept either, preferring the publishable key when both are present.
 */
export const supabasePublishableKey: string | undefined =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
