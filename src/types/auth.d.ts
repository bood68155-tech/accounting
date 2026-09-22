// ─── Auth.js module augmentation ──────────────────────────────────────────────
// Extends the default session/JWT with the user's tenant context (resolved at
// login, embedded in the JWT). Uses the official "import the module, then
// re-declare" pattern from the Auth.js v5 fast-refresh/quickstart docs so it
// works under bundler moduleResolution.
import { DefaultSession } from "next-auth";
// The import registers "next-auth/jwt" in the program so the augmentation
// below resolves; the symbol itself is intentionally unused.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { JWT as CoreJWT } from "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      /** Auth.js user id (public.users.id). */
      id: string;
      email: string;
      name?: string | null;
      /** The user's tenant id (public.tenants.id). */
      tenantId?: string | null;
      /** Display name of the user's tenant. */
      tenantName?: string | null;
      /** Postgres schema holding this tenant's data (tenant_<uuid-hex>). */
      tenantSchema?: string | null;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    tenantId?: string | null;
    tenantName?: string | null;
    tenantSchema?: string | null;
  }
}
