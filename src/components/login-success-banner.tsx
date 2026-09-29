"use client";

import { useSearchParams } from "next/navigation";
import { IconCheck } from "@/components/icons";

/**
 * Banner shown on /login after a successful password reset
 * (?reset=success). Rendered above the sign-in form as a fixed toast.
 */
export function LoginSuccessBanner() {
  const params = useSearchParams();
  if (params.get("reset") !== "success") return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
      <p className="pointer-events-auto flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300 shadow-lg backdrop-blur">
        <IconCheck className="h-4 w-4" />
        Password reset successfully — sign in with your new password.
      </p>
    </div>
  );
}
