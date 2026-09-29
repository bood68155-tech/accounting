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
      <p className="animate-fade-in pointer-events-auto flex items-center gap-2.5 border border-white bg-white px-4 py-2.5 text-xs font-bold uppercase tracking-[0.08em] text-black shadow-[4px_4px_0_0_#ff3b00]">
        <IconCheck className="h-4 w-4 text-accent" />
        Password reset successfully — sign in with your new password.
      </p>
    </div>
  );
}
