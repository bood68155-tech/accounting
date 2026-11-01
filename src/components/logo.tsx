import { cn } from "@/lib/utils";

/**
 * NUV mark — the NUV Agency fedora-and-ring icon, adapted to the accounting
 * palette. The structure is unchanged: a pinched fedora sits on an open ring.
 * Tones are remapped to the dashboard's pitch-black / stark-white / signal-red
 * system — white hat, inverted band, signal-red ring.
 *
 * Every part accepts an explicit color so the mark can be re-tinted per
 * surface (dark rail, red callout blocks, email headers) without a second SVG.
 */
export function LogoMark({
  size = 32,
  className,
  hat = "var(--logo-hat, currentColor)",
  ring = "var(--logo-ring, var(--accent))",
  band = "var(--logo-band, var(--background, #000))",
}: {
  size?: number;
  className?: string;
  hat?: string;
  ring?: string;
  band?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden
      className={className}
    >
      {/* Ring — drawn first; its crown is covered by the hat brim */}
      <circle cx="24" cy="30.4" r="14.4" stroke={ring} strokeWidth="3" fill="none" />

      {/* Crown — fedora peak with a shallow center crease */}
      <path
        d="M13.4 22.6c0-7.1 2.3-12.8 5.7-14.8 1.3-.8 2.5-.3 3.2.8.7-1 1.9-1.5 3.2-.7 3.5 2 5.7 7.6 5.7 14.7H13.4Z"
        fill={hat}
      />

      {/* Brim — wide sweep, thinner at both tips */}
      <path
        d="M3 23.4C8.8 20.6 15.4 19.2 22.4 19.2h3.2c7 0 13.6 1.4 19.4 4.2.7.3.7 1 .1 1.2-6.4 2.2-13.4 3.6-21.1 3.6S9.4 26.8 2.9 24.6c-.6-.2-.6-.9.1-1.2Z"
        fill={hat}
      />

      {/* Band — the accent wrap around the crown base */}
      <path
        d="M14 20.1c3.2-.6 6.4-.9 9.6-.9s6.4.3 9.6.9l.5 2.2c-3.3-.7-6.7-1-10.1-1s-6.8.3-10.1 1l.5-2.2Z"
        fill={band}
      />
    </svg>
  );
}

export function Logo({
  size = 30,
  showText = true,
  className,
}: {
  size?: number;
  showText?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark size={size} />
      {showText && (
        <span className="text-[15px] font-extrabold uppercase tracking-[-0.01em] whitespace-nowrap text-white">
          NUV<span className="text-accent"> Accounting</span>
        </span>
      )}
    </span>
  );
}
