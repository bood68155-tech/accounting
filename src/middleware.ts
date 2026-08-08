import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { supabasePublishableKey } from "@/lib/supabase/env";

export async function middleware(request: NextRequest) {
  // Skip session handling entirely until Supabase is configured, so the
  // demo mode works without credentials.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !supabasePublishableKey) {
    return NextResponse.next({ request });
  }
  const { supabaseResponse } = await updateSession(request);
  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Run on everything except static assets and images.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
