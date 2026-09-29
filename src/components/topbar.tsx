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
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-white px-4 sm:gap-4 sm:px-6">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          {backHref && (
            <Link
              href={backHref}
              aria-label="Go back"
              className="flex h-7 w-7 items-center justify-center border border-zinc-700 text-zinc-400 transition-colors duration-100 hover:border-white hover:text-white"
            >
              <IconChevronLeft className="h-4 w-4" />
            </Link>
          )}
          <h1 className="truncate text-[15px] font-bold uppercase tracking-[0.04em] text-white">
            {title}
          </h1>
        </div>
        {subtitle && (
          <p className="type-kicker mt-0.5 truncate text-zinc-500">{subtitle}</p>
        )}
      </div>

      <div className="flex items-center gap-2.5">
        <div className="relative hidden md:block">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
          <input
            placeholder="Search orders, SKUs…"
            className="h-9 w-48 rounded-none border border-zinc-700 bg-transparent pl-9 pr-3 text-sm text-white transition-[border-color] duration-100 placeholder:text-zinc-600 hover:border-zinc-500 focus:border-accent focus:outline-none lg:w-56"
          />
        </div>
        <Button href="/stores/new" size="sm" className="hidden sm:inline-flex">
          <IconPlus className="h-4 w-4" /> Connect store
        </Button>
        <button
          aria-label="Notifications"
          className="relative flex h-9 w-9 items-center justify-center border border-zinc-700 text-zinc-400 transition-colors duration-100 hover:border-white hover:text-white"
        >
          <IconBell className="h-4.5 w-4.5" />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 bg-accent" />
        </button>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center bg-accent text-xs font-bold text-white">
          AO
        </div>
      </div>
    </header>
  );
}
