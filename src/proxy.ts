import { type NextRequest, NextResponse } from "next/server";

/**
 * Cheap edge guard: bounce requests without a session cookie before they hit
 * server components. Cryptographic verification happens in the NextAuth JWT
 * (verified by `auth()` in layouts and route handlers) — this is only a fast
 * pre-filter, not the security boundary.
 */

const SESSION_COOKIE = "authjs.session-token"; // __Secure- prefixed in production

export function proxy(request: NextRequest) {
  const hasSession =
    request.cookies.has(SESSION_COOKIE) ||
    request.cookies.has(`__Secure-${SESSION_COOKIE}`);

  if (!hasSession) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/orders/:path*",
    "/ledger/:path*",
    "/reports/:path*",
    "/settings/:path*",
    "/stores/:path*",
    "/admin/:path*",
  ],
};
