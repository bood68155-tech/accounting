import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const variantClasses: Record<ButtonVariant, string> = {
  /* Signal red block — the one loud element on the black canvas. */
  primary:
    "bg-accent text-white border border-accent hover:bg-white hover:text-black hover:border-white active:translate-y-px shadow-[4px_4px_0_0_#ffffff] hover:shadow-[2px_2px_0_0_#ffffff]",
  secondary:
    "bg-zinc-900 text-zinc-100 border border-zinc-700 hover:bg-zinc-800 hover:border-zinc-500",
  ghost: "text-zinc-300 hover:bg-zinc-900 hover:text-white",
  outline:
    "bg-transparent text-white border border-white/70 hover:bg-white hover:text-black active:translate-y-px",
  danger:
    "bg-transparent text-red-400 border border-red-500/60 hover:bg-red-500 hover:text-white hover:border-red-500",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-none",
  md: "h-11 px-5 text-sm gap-2 rounded-none",
  lg: "h-12 px-7 text-[15px] gap-2 rounded-none uppercase tracking-[0.08em] font-semibold",
  icon: "h-10 w-10 rounded-none",
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
    "inline-flex items-center justify-center font-medium transition-colors duration-100 select-none",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black",
    "disabled:opacity-40 disabled:pointer-events-none",
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
