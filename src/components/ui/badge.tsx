import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "success" | "warning" | "danger" | "info" | "neutral";

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-accent text-white border border-accent",
  success: "bg-emerald-500 text-white border border-emerald-500",
  warning: "bg-amber-400 text-black border border-amber-400",
  danger: "bg-red-500 text-white border border-red-500",
  info: "bg-white text-black border border-white",
  neutral: "bg-transparent text-zinc-300 border border-zinc-700",
};

export function Badge({
  variant = "default",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-none px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] leading-4",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
