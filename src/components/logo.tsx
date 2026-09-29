import { cn } from "@/lib/utils";

export function Logo({ size = 30, showText = true, className }: { size?: number; showText?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
        {/* Solid signal-red block — sharp corners */}
        <rect width="32" height="32" fill="#ff3b00" />
        {/* Ledger lines */}
        <path d="M9 10.5h14M9 15h14M9 19.5h9" stroke="#000000" strokeWidth="2.2" strokeLinecap="square" />
        {/* Checkmark */}
        <path d="M18.5 21.5 22 25l5-6.5" stroke="#000000" strokeWidth="2.4" strokeLinecap="square" strokeLinejoin="miter" />
      </svg>
      {showText && (
        <span className="text-[15px] font-extrabold uppercase tracking-[-0.01em] text-white">
          Store<span className="text-accent">Accountant</span>
        </span>
      )}
    </span>
  );
}
