import { cn } from "@/lib/utils";

/**
 * Brutalist field: transparent black, 1px outline, sharp corners.
 * Focus = signal-red border + hard white offset shadow. No soft halos.
 */
export const inputClasses =
  "w-full h-12 rounded-none border border-zinc-700 bg-transparent px-4 text-sm text-white placeholder:text-zinc-600 transition-[border-color,box-shadow] duration-100 hover:border-zinc-500 focus:outline-none focus:border-accent focus:shadow-[4px_4px_0_0_#ffffff]";

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> }) {
  // React 19: ref is a regular prop and is spread onto the DOM input,
  // enabling one-time-code (OTP) focus management without forwardRef.
  return <input className={cn(inputClasses, className)} {...props} />;
}
