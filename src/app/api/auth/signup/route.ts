import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { requireDb, publicSchema } from "@/lib/db";
import { verifyVerifiedToken } from "@/lib/auth/verification";

export const dynamic = "force-dynamic";

/**
 * ── Signup (Drizzle + Neon) ───────────────────────────────────────────────────
 * Requires a verified email first: the client must POST /api/auth/otp/request
 * (6-digit code sent to the Gmail address) then /api/auth/otp/verify, and pass
 * the returned short-lived `otpToken` here. Creates the user (bcrypt-hashed
 * password) and provisions the tenant schema atomically via db.batch (Neon
 * HTTP executes the batch as a single transaction), then the client signs in
 * via the credentials flow with the same otpToken.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: "Database is not configured — set DATABASE_URL (Neon) in the environment." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    full_name?: string;
    otpToken?: string;
  };

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const fullName = (body.full_name ?? "").trim() || null;
  const otpToken = body.otpToken ?? "";

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (password && password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
  }
  if (!verifyVerifiedToken(otpToken, email, "signup")) {
    return NextResponse.json(
      { error: "Email not verified — request the 6-digit code and verify it first." },
      { status: 403 },
    );
  }

  const db = requireDb();
  const { users, profiles } = publicSchema;

  try {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing.length > 0) {
      return NextResponse.json(
        { error: "An account with this email already exists — sign in instead." },
        { status: 409 },
      );
    }

    const passwordHash = password ? await bcrypt.hash(password, 12) : null;

    // The user id is generated up front so no statement depends on another's
    // result — required for Neon HTTP batch (non-interactive) transactions.
    const userId = randomUUID();
    // Tenant/schema provisioning stays in raw SQL: provision_user_tenant()
    // runs dynamic DDL (create_tenant_schema) that an ORM cannot express.
    // Values are bound parameters; the function is created by the migration.
    const provision = sql`select public.provision_user_tenant(${userId}::uuid, ${email}, ${fullName ?? ""})`;

    await db.batch([
      db.insert(users).values({ id: userId, email, passwordHash, emailVerified: new Date() }),
      db.insert(profiles).values({ id: userId, fullName }),
      db.execute(provision),
    ] as never);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Signup failed: ${message}` }, { status: 500 });
  }
}
