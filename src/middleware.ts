import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { supabasePublishableKey } from "@/lib/supabase/env";

export async function middleware(request: NextRequest) {
  // The app requires Supabase credentials (no demo mode). Until they are set,
  // skip session handling so pages can render a "configure me" state instead
  // of crashing.
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
