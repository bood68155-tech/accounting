import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/auth";
import { fetchAdminFees } from "@/lib/admin/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireAdminAccess();
  if (!access.granted) {
    return NextResponse.json({ error: access.message }, { status: access.status });
  }
  const fees = await fetchAdminFees();
  return NextResponse.json({ mode: access.demo ? "demo" : "live", fees });
}
