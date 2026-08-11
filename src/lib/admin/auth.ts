import { isSupabaseConfigured } from "@/lib/data/config";
import { createClient } from "@/lib/supabase/server";

// ─── Admin authorization ──────────────────────────────────────────────────────
// Strict guard: ONLY the platform owner can access the admin console.
// In live mode, the signed-in user's email must be the designated admin email.

/** The sole authorized admin email for the platform. */
const ADMIN_EMAIL = "bood68155@gmail.com";

export function adminEmails(): string[] {
  // Support both the hardcoded admin email AND any env-configured emails.
  const envEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const all = new Set([ADMIN_EMAIL, ...envEmails]);
  return [...all];
}

export function hasAdminAccessConfigured(): boolean {
  return true; // Admin access is always configured (hardcoded admin email).
}

/**
 * Strict email check — only the designated platform owner email is accepted.
 * This is the primary access control gate for the admin console.
 */
export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  // Check against all configured admin emails (includes hardcoded + env).
  return adminEmails().includes(normalized);
}

export type AdminAccess =
  | { granted: true; demo: boolean }
  | { granted: false; status: number; message: string };

/** Guard used by admin API routes and the admin page. */
export async function requireAdminAccess(): Promise<AdminAccess> {
  if (!isSupabaseConfigured()) return { granted: true, demo: true };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return { granted: false, status: 401, message: "Sign in to access the admin console." };
  }
  if (!isAdminEmail(user.email)) {
    return { granted: false, status: 403, message: "Your account is not an administrator." };
  }
  return { granted: true, demo: false };
}
