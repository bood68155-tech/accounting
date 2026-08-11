import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/auth";
import { fetchAdminEvents } from "@/lib/admin/queries";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await requireAdminAccess();
  if (!access.granted) {
    return NextResponse.json({ error: access.message }, { status: access.status });
  }

  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider");
  const status = searchParams.get("status");

  const { events, summary } = await fetchAdminEvents();
  const filtered = events.filter(
    (e) =>
      (!provider || e.provider === provider) &&
      (!status || e.status === status),
  );

  return NextResponse.json({ mode: access.demo ? "demo" : "live", events: filtered, summary });
}
