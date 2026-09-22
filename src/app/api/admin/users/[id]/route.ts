import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdminAccess } from "@/lib/admin/auth";
import { isDatabaseConfigured, requireDb, publicSchema } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const access = await requireAdminAccess();
  if (!access.granted) {
    return NextResponse.json({ error: access.message }, { status: access.status });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Writes require a live database (DATABASE_URL)." },
      { status: 400 },
    );
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    full_name?: string;
    banned?: boolean;
  };

  const db = requireDb();
  const { profiles, users } = publicSchema;

  if (typeof body.full_name === "string") {
    await db
      .insert(profiles)
      .values({ id, fullName: body.full_name })
      .onConflictDoUpdate({
        target: profiles.id,
        set: { fullName: body.full_name, updatedAt: new Date() },
      });
  }

  if (typeof body.banned === "boolean") {
    await db
      .update(users)
      .set({ disabled: body.banned, updatedAt: new Date() })
      .where(eq(users.id, id));
  }

  return NextResponse.json({ ok: true });
}
