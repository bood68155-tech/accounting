import { redirect } from "next/navigation";
import { isAdminEmail } from "@/lib/admin/auth";
import { auth } from "@/lib/auth";

/**
 * ── Admin route protection (server-side) ─────────────────────────────────────
 * Wraps every /admin/* route. Non-admin users are redirected before any admin
 * page or data fetch runs. The PIN gate inside the page adds a second factor.
 * Defense in depth: API routes also call requireAdminAccess() themselves.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!isAdminEmail(session.user.email)) redirect("/dashboard");
  return <>{children}</>;
}
