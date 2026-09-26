import { cn } from "@/lib/utils";

export const inputClasses =
  "w-full h-10 rounded-xl border border-zinc-800 bg-zinc-900/70 px-3.5 text-sm text-zinc-100 placeholder:text-zinc-600 transition-colors focus:outline-none focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/15";

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> }) {
  // React 19: ref is a regular prop and is spread onto the DOM input,
  // enabling one-time-code (OTP) focus management without forwardRef.
  return <input className={cn(inputClasses, className)} {...props} />;
}
