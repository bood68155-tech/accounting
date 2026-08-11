import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/auth";
import { fetchAdminOverview } from "@/lib/admin/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireAdminAccess();
  if (!access.granted) {
    return NextResponse.json({ error: access.message }, { status: access.status });
  }
  const overview = await fetchAdminOverview();
  return NextResponse.json({ mode: access.demo ? "demo" : "live", overview });
}
