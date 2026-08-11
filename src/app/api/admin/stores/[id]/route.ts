import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/auth";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase/admin";
import type { StoreStatus } from "@/types";

export const dynamic = "force-dynamic";

const VALID_STATUSES: StoreStatus[] = ["connected", "syncing", "disconnected"];

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const access = await requireAdminAccess();
  if (!access.granted) {
    return NextResponse.json({ error: access.message }, { status: access.status });
  }
  if (access.demo || !hasAdminCredentials()) {
    return NextResponse.json(
      { error: "Writes require a live database (SUPABASE_SERVICE_ROLE_KEY)." },
      { status: 400 },
    );
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { status?: string };

  if (!body.status || !VALID_STATUSES.includes(body.status as StoreStatus)) {
    return NextResponse.json({ error: "Invalid store status." }, { status: 400 });
  }

  const { error } = await createAdminClient()
    .from("stores")
    .update({ status: body.status as StoreStatus })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
