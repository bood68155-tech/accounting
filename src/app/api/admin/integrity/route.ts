import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/auth";
import { fetchPlatformIntegrity } from "@/lib/admin/integrity";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/integrity — platform-wide double-entry integrity across every
 * tenant schema (Σ debits vs Σ credits per entry). Admin-only.
 */
export async function GET() {
  const access = await requireAdminAccess();
  if (!access.granted) {
    return NextResponse.json({ error: access.message }, { status: access.status });
  }
  const integrity = await fetchPlatformIntegrity();
  return NextResponse.json({ integrity });
}
