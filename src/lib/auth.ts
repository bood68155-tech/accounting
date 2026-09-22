import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { requireDb, publicSchema } from "@/lib/db";

/**
 * ── Auth (NextAuth v5 / Auth.js, credentials + Drizzle over Neon) ─────────────
 * Passwords are bcrypt-hashed in public.users; sessions are stateless JWTs
 * (no session table needed).
 *
 * The user's tenant (id, name, schema) is resolved once at login and embedded
 * in the token, so every server-side read can scope itself to the tenant
 * schema without extra queries or cookies.
 */

export interface SessionUser {
  id: string;
  email: string;
  name?: string | null;
  tenantId?: string | null;
  tenantName?: string | null;
  tenantSchema?: string | null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        if (!process.env.DATABASE_URL) return null;
        const email = String(raw?.email ?? "").trim().toLowerCase();
        const password = String(raw?.password ?? "");
        if (!email || !password) return null;

        const db = requireDb();
        const { users, profiles, tenantUsers, tenants } = publicSchema;

        const rows = await db
          .select({
            id: users.id,
            email: users.email,
            passwordHash: users.passwordHash,
            disabled: users.disabled,
            fullName: profiles.fullName,
            tenantId: tenants.id,
            tenantName: tenants.name,
            schemaName: tenants.schemaName,
          })
          .from(users)
          .leftJoin(profiles, eq(profiles.id, users.id))
          .leftJoin(tenantUsers, eq(tenantUsers.userId, users.id))
          .leftJoin(tenants, eq(tenants.id, tenantUsers.tenantId))
          .where(eq(users.email, email))
          .limit(1);

        const row = rows[0];
        if (!row || row.disabled) return null;
        if (!(await bcrypt.compare(password, row.passwordHash))) return null;

        await db
          .update(users)
          .set({ lastLoginAt: new Date() })
          .where(eq(users.id, row.id));

        return {
          id: row.id,
          email: row.email,
          name: row.fullName ?? row.email,
          tenantId: row.tenantId ?? null,
          tenantName: row.tenantName ?? null,
          tenantSchema: row.schemaName ?? null,
        } satisfies SessionUser;
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        const u = user as SessionUser;
        token.uid = u.id;
        token.tenantId = u.tenantId ?? null;
        token.tenantName = u.tenantName ?? null;
        token.tenantSchema = u.tenantSchema ?? null;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = (token.uid as string | undefined) ?? "";
      session.user.tenantId = (token.tenantId as string | null | undefined) ?? null;
      session.user.tenantName = (token.tenantName as string | null | undefined) ?? null;
      session.user.tenantSchema = (token.tenantSchema as string | null | undefined) ?? null;
      return session;
    },
  },
});
