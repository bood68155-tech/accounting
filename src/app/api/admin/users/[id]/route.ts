import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/auth";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

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
  const body = (await request.json().catch(() => ({}))) as {
    full_name?: string;
    banned?: boolean;
  };

  const supabase = createAdminClient();

  if (typeof body.full_name === "string") {
    const { error } = await supabase
      .from("profiles")
      .upsert({ id, full_name: body.full_name }, { onConflict: "id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (typeof body.banned === "boolean") {
    const { error } = await supabase.auth.admin.updateUserById(id, {
      ban_duration: body.banned ? "876000h" : "none",
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
