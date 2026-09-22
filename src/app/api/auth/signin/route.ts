import { NextResponse } from "next/server";
import { getCsrfToken } from "next-auth/react";
import { createHash } from "node:crypto";

export const dynamic = "force-dynamic";

/**
 * ── Programmatic sign-in ──────────────────────────────────────────────────────
 * NextAuth's credentials flow is a form POST to /api/auth/callback/credentials
 * with a CSRF token. This route performs that dance server-side so the client
 * can simply POST JSON { email, password } and get back the session cookie.
 *
 * The NextAuth JWT cookie is set via the callback's Set-Cookie header, which
 * we forward verbatim (it is httpOnly and signed by AUTH_SECRET).
 */

function csrfCookieName(token: string): string {
  // Auth.js hashes the CSRF token into the cookie name (SHA-256, base64url).
  return `authjs.csrf-token.${createHash("sha256").update(token).digest("base64url")}`;
}

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
  };
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const origin = new URL(request.url).origin;
  const csrfToken = await getCsrfToken();

  if (!csrfToken) {
    return NextResponse.json(
      { error: "Auth service unavailable — check AUTH_SECRET configuration." },
      { status: 500 },
    );
  }

  const form = new URLSearchParams({
    email,
    password,
    csrfToken,
    callbackUrl: `${origin}/dashboard`,
    json: "true",
  });

  const callbackRes = await fetch(`${origin}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // Auth.js requires both the cookie and the form field to carry the token.
      "Cookie": `${csrfCookieName(csrfToken)}=${encodeURIComponent(`${csrfToken}|`)}`,
      "User-Agent": request.headers.get("user-agent") ?? "X-App",
    },
    body: form.toString(),
    redirect: "manual",
  });

  // The callback answers 302 on success (to callbackUrl) and 401 on bad
  // credentials when `json: true`.
  if (callbackRes.status === 401) {
    return NextResponse.json(
      { error: "Incorrect email or password." },
      { status: 401 },
    );
  }
  if (callbackRes.status >= 400) {
    return NextResponse.json(
      { error: `Sign-in failed (HTTP ${callbackRes.status}).` },
      { status: 502 },
    );
  }

  const out = NextResponse.json({ ok: true });

  // Forward every Set-Cookie from the callback (session + csrf clearing).
  const setCookies = callbackRes.headers.getSetCookie?.() ?? [];
  for (const cookie of setCookies) {
    out.headers.append("Set-Cookie", cookie);
  }

  return out;
}
