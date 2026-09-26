import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { requireDb, publicSchema, isDatabaseConfigured } from "@/lib/db";
import { verifyVerifiedToken } from "@/lib/auth/verification";

/**
 * ── Auth (NextAuth v5 / Auth.js: credentials + Google OAuth + email OTP) ──────
 * Passwords are bcrypt-hashed in public.users; sessions are stateless JWTs
 * (no session table needed). Google accounts sign in via OAuth — on first
 * login the user row + tenant schema are provisioned automatically.
 *
 * Email OTP flow: signup and password sign-in REQUIRE a short-lived
 * `otpToken` produced by /api/auth/otp/verify (6-digit code proven), passed
 * as a credential alongside email/password.
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

/** Resolve (id, name, schema) of the user's tenant, if provisioned. */
async function tenantForUser(db: ReturnType<typeof requireDb>, userId: string) {
  const { tenants, tenantUsers } = publicSchema;
  const rows = await db
    .select({
      tenantId: tenants.id,
      tenantName: tenants.name,
      schemaName: tenants.schemaName,
    })
    .from(tenantUsers)
    .innerJoin(tenants, eq(tenants.id, tenantUsers.tenantId))
    .where(eq(tenantUsers.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Create the user's tenant + schema via the migration-provided SQL helper.
 * Mirrors the provisioning path of /api/auth/signup (provision_user_tenant).
 */
async function provisionTenant(db: ReturnType<typeof requireDb>, userId: string, email: string, fullName: string | null) {
  const name = fullName?.trim() || email.split("@")[0] || "Workspace";
  await db.execute(
    sql`select public.provision_user_tenant(${userId}::uuid, ${email}, ${name})`,
  );
  return tenantForUser(db, userId);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {}, otpToken: {} },
      async authorize(raw) {
        if (!isDatabaseConfigured()) return null;
        const email = String(raw?.email ?? "").trim().toLowerCase();
        const password = String(raw?.password ?? "");
        const otpToken = String(raw?.otpToken ?? "");
        if (!email || !password || !otpToken) return null;

        // The 6-digit code must have been verified moments ago — the token is
        // bound to email + "login" + a 10-minute expiry (HMAC, AUTH_SECRET).
        if (!verifyVerifiedToken(otpToken, email, "login")) return null;

        const db = requireDb();
        const { users, profiles } = publicSchema;

        const rows = await db
          .select({
            id: users.id,
            email: users.email,
            passwordHash: users.passwordHash,
            disabled: users.disabled,
            fullName: profiles.fullName,
          })
          .from(users)
          .leftJoin(profiles, eq(profiles.id, users.id))
          .where(eq(users.email, email))
          .limit(1);

        const row = rows[0];
        if (!row || row.disabled || !row.passwordHash) return null;
        if (!(await bcrypt.compare(password, row.passwordHash))) return null;

        await db
          .update(users)
          .set({ lastLoginAt: new Date() })
          .where(eq(users.id, row.id));

        const tenant = await tenantForUser(db, row.id);

        return {
          id: row.id,
          email: row.email,
          name: row.fullName ?? row.email,
          tenantId: tenant?.tenantId ?? null,
          tenantName: tenant?.tenantName ?? null,
          tenantSchema: tenant?.schemaName ?? null,
        } satisfies SessionUser;
      },
    }),

    // Google OAuth — enabled automatically when GOOGLE_CLIENT_ID/SECRET are
    // set; the login UI hides the Google button otherwise.
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            authorization: {
              params: {
                prompt: "consent",
                access_type: "offline",
                response_type: "code",
              },
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ user, account }) {
      // Google (or any OAuth provider): upsert the local user, link the
      // account, and provision the tenant schema on first login.
      if (account?.provider && account.provider !== "credentials") {
        if (!isDatabaseConfigured() || !user.email) return false;

        const db = requireDb();
        const { users, profiles, accounts: accountsTable } = publicSchema;
        const email = user.email.toLowerCase();

        const existing = await db
          .select({ id: users.id, disabled: users.disabled })
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        let userId: string;
        if (existing.length > 0) {
          if (existing[0].disabled) return false; // admin-disabled accounts can't sign in
          userId = existing[0].id;
        } else {
          // First OAuth login: create user + profile, then provision tenant.
          userId = randomUUID();
          const fullName = user.name ?? email.split("@")[0];
          await db.batch([
            db.insert(users).values({
              id: userId,
              email,
              passwordHash: null, // OAuth users have no local password
              emailVerified: new Date(),
            }),
            db.insert(profiles).values({ id: userId, fullName, avatarUrl: user.image ?? null }),
          ] as never);
          await provisionTenant(db, userId, email, fullName);
        }

        // Link the provider identity (idempotent).
        await db
          .insert(accountsTable)
          .values({
            userId,
            provider: account.provider,
            providerAccountId: account.providerAccountId,
            accessToken: account.access_token ?? null,
            tokenType: account.token_type ?? null,
            scope: account.scope ?? null,
          })
          .onConflictDoNothing({
            target: [accountsTable.provider, accountsTable.providerAccountId],
          });

        await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));

        // Attach the local user id so the jwt callback can resolve the tenant.
        (user as SessionUser).id = userId;
        return true;
      }
      return true;
    },

    async jwt({ token, user, account }) {
      if (user) {
        const u = user as SessionUser;
        token.uid = u.id;
        token.tenantId = u.tenantId ?? null;
        token.tenantName = u.tenantName ?? null;
        token.tenantSchema = u.tenantSchema ?? null;

        // OAuth path: signIn() set only the id — resolve the tenant here.
        if (account?.provider && account.provider !== "credentials" && !token.tenantId && isDatabaseConfigured()) {
          try {
            const db = requireDb();
            const tenant = await tenantForUser(db, u.id);
            token.tenantId = tenant?.tenantId ?? null;
            token.tenantName = tenant?.tenantName ?? null;
            token.tenantSchema = tenant?.schemaName ?? null;
          } catch {
            // Leave tenant null; getTenantContext() treats it as not provisioned.
          }
        }
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
