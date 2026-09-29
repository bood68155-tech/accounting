import { cn } from "@/lib/utils";

/**
 * Refined field treatment: navy field surface, hairline border, crisp emerald
 * focus ring with soft halo, and a subtle hover lift of the border tone.
 */
export const inputClasses =
  "w-full h-10 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3.5 text-sm text-zinc-100 shadow-[inset 0_1px_2px_rgba(0,0,0,0.35)] placeholder:text-zinc-600 transition-[border-color,box-shadow,background-color] duration-200 hover:border-zinc-700 focus:outline-none focus:border-emerald-500/70 focus:bg-zinc-900/80 focus:ring-[3px] focus:ring-emerald-500/15";

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> }) {
  // React 19: ref is a regular prop and is spread onto the DOM input,
  // enabling one-time-code (OTP) focus management without forwardRef.
  return <input className={cn(inputClasses, className)} {...props} />;
}
