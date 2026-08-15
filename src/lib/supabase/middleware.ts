import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabasePublishableKey } from "@/lib/supabase/env";
import { TENANT_ID_COOKIE, TENANT_SCHEMA_COOKIE } from "@/lib/tenants";

/**
 * Refresh the Supabase auth session on every request (keeps login alive) and
 * resolve the signed-in user's tenant so the rest of the app can scope every
 * query to the right tenant schema (schema-per-tenant isolation).
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabasePublishableKey!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Important: do not run code between `createServerClient` and `supabase.auth.getUser()`.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const cookieOptions = {
    httpOnly: false,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days — refreshed on every request
  };

  if (user) {
    // Resolve the user's tenant through the shared `public` schema (RLS keeps
    // this scoped to rows the user belongs to). `tenants!inner(...)` is an
    // embedded relation, so it comes back as an array.
    const { data: membership } = await supabase
      .from("tenant_users")
      .select("tenant_id, tenants!inner(id, schema_name)")
      .eq("user_id", user.id)
      .maybeSingle();

    const tenant = membership?.tenants?.[0];
    if (tenant?.id && tenant.schema_name) {
      supabaseResponse.cookies.set(TENANT_ID_COOKIE, tenant.id, cookieOptions);
      supabaseResponse.cookies.set(TENANT_SCHEMA_COOKIE, tenant.schema_name, cookieOptions);
    } else {
      // Signed in but no tenant yet (e.g. database not migrated) — clear any stale values.
      supabaseResponse.cookies.delete(TENANT_ID_COOKIE);
      supabaseResponse.cookies.delete(TENANT_SCHEMA_COOKIE);
    }
  } else {
    supabaseResponse.cookies.delete(TENANT_ID_COOKIE);
    supabaseResponse.cookies.delete(TENANT_SCHEMA_COOKIE);
  }

  return { supabase, user, supabaseResponse };
}
