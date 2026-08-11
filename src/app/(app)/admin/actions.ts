"use server";

import { cookies, headers } from "next/headers";
import { ADMIN_PIN_COOKIE, issuePinToken, pinMatches } from "@/lib/admin/pin";

// ─── Admin PIN verification (server-only) ─────────────────────────────────────
// Verifies the PIN, rate-limits failures per IP, and on success issues an
// httpOnly cookie (HMAC-signed, keyed by the PIN) that unlocks the admin
// console. The cookie value cannot be forged without knowing the PIN.

const FAIL_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

/** In-memory failed-attempt log, keyed by client IP. Per server instance. */
const failedAttempts = new Map<string, number[]>();

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export type VerifyPinResult = { ok: true } | { ok: false; error: string };

export async function verifyAdminPin(formData: FormData): Promise<VerifyPinResult> {
  const pin = String(formData.get("pin") ?? "").trim();
  const ip = await clientIp();
  const now = Date.now();

  // Prune expired failures, then enforce the lockout window.
  const recent = (failedAttempts.get(ip) ?? []).filter((t) => now - t < FAIL_WINDOW_MS);
  if (recent.length >= MAX_ATTEMPTS) {
    failedAttempts.set(ip, recent);
    return {
      ok: false,
      error: "Too many failed attempts. Please wait 15 minutes and try again.",
    };
  }

  if (!pinMatches(pin)) {
    recent.push(now);
    failedAttempts.set(ip, recent);
    return { ok: false, error: "Incorrect PIN. Please try again." };
  }

  failedAttempts.delete(ip);

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_PIN_COOKIE, issuePinToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 12, // 12 hours
    path: "/",
  });

  return { ok: true };
}
