import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-emerald-400 text-[#04120c] hover:bg-emerald-300 active:bg-emerald-500 shadow-[0_1px_0_rgba(255,255,255,0.25)_inset,0_8px_20px_-8px_rgba(52,211,153,0.45)] hover:shadow-[0_1px_0_rgba(255,255,255,0.3)_inset,0_10px_28px_-8px_rgba(52,211,153,0.55)] hover:-translate-y-px active:translate-y-0",
  secondary:
    "bg-zinc-800/80 text-zinc-100 hover:bg-zinc-700/80 border border-zinc-700/60 hover:border-zinc-600",
  ghost: "text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100",
  outline:
    "border border-zinc-700/80 bg-zinc-900/40 text-zinc-200 hover:bg-zinc-800/70 hover:border-zinc-600 hover:text-zinc-50",
  danger:
    "bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/30 hover:text-red-300",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-xl",
  lg: "h-12 px-6 text-[15px] gap-2 rounded-xl",
  icon: "h-10 w-10 rounded-xl",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  href?: string;
}

export function Button({
  variant = "primary",
  size = "md",
  href,
  className,
  children,
  ...props
}: ButtonProps) {
  const classes = cn(
    "inline-flex items-center justify-center font-medium transition-all duration-200 ease-out select-none",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0d14]",
    "disabled:opacity-50 disabled:pointer-events-none disabled:shadow-none",
    "active:scale-[0.99]",
    variantClasses[variant],
    sizeClasses[size],
    className,
  );

  if (href) {
    return (
      <a href={href} className={classes}>
        {children}
      </a>
    );
  }
  return (
    <button className={classes} {...props}>
      {children}
    </button>
  );
}
