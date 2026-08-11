import Link from "next/link";
import { Button } from "@/components/ui/button";
import { IconBell, IconChevronLeft, IconPlus, IconSearch } from "@/components/icons";

export function Topbar({
  title,
  subtitle,
  backHref,
}: {
  title: string;
  subtitle?: string;
  backHref?: string;
}) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-zinc-800/70 px-6">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {backHref && (
            <Link
              href={backHref}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/70 text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
            >
              <IconChevronLeft className="h-4 w-4" />
            </Link>
          )}
          <h1 className="truncate text-[15px] font-semibold tracking-tight text-zinc-50">
            {title}
          </h1>
        </div>
        {subtitle && <p className="truncate text-xs text-zinc-500">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-2.5">
        <div className="relative hidden md:block">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
          <input
            placeholder="Search orders, SKUs…"
            className="h-9 w-56 rounded-xl border border-zinc-800 bg-zinc-900/70 pl-9 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 transition-colors focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/15"
          />
        </div>
        <Button href="/stores/new" size="sm" variant="primary">
          <IconPlus className="h-4 w-4" /> Connect store
        </Button>
        <button className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/70 text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200">
          <IconBell className="h-4.5 w-4.5" />
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-emerald-400" />
        </button>
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 text-xs font-bold text-emerald-950">
          AO
        </div>
      </div>
    </header>
  );
}
