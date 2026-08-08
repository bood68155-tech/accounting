import { cn } from "@/lib/utils";

export function Logo({ size = 30, showText = true, className }: { size?: number; showText?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
        <defs>
          <linearGradient id="logo-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
            <stop stopColor="#34d399" />
            <stop offset="1" stopColor="#0d9488" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="9" fill="url(#logo-grad)" />
        {/* ledger lines */}
        <path d="M9 10.5h14M9 15h14M9 19.5h9" stroke="#042f2e" strokeWidth="2.2" strokeLinecap="round" opacity="0.85" />
        {/* checkmark */}
        <path d="M18.5 21.5 22 25l5-6.5" stroke="#042f2e" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
      </svg>
      {showText && (
        <span className="text-[15px] font-bold tracking-tight text-zinc-50">
          Store<span className="text-emerald-400">Accountant</span>
        </span>
      )}
    </span>
  );
}
