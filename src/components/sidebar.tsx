"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/logo";
import {
  IconDashboard,
  IconLedger,
  IconOrders,
  IconReport,
  IconSettings,
  IconStore,
} from "@/components/icons";
import { cn } from "@/lib/utils";

const NAV = [
  {
    section: "Overview",
    items: [{ href: "/dashboard", label: "Dashboard", icon: IconDashboard }],
  },
  {
    section: "Sales",
    items: [
      { href: "/stores", label: "Stores", icon: IconStore },
      { href: "/orders", label: "Orders", icon: IconOrders },
    ],
  },
  {
    section: "Accounting",
    items: [
      { href: "/ledger", label: "General Ledger", icon: IconLedger },
      { href: "/reports/income-statement", label: "Income Statement", icon: IconReport },
    ],
  },
  {
    section: "Settings",
    items: [{ href: "/settings", label: "Settings", icon: IconSettings }],
  },
];

export function Sidebar({ demoMode }: { demoMode: boolean }) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);

  return (
    <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-zinc-800/70 bg-zinc-950/70 backdrop-blur">
      <div className="flex h-16 items-center border-b border-zinc-800/70 px-5">
        <Link href="/dashboard" className="transition-opacity hover:opacity-80">
          <Logo />
        </Link>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
        {NAV.map((group) => (
          <div key={group.section}>
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
              {group.section}
            </p>
            <div className="space-y-1">
              {group.items.map((item) => {
                const active = isActive(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-150",
                      active
                        ? "bg-emerald-500/10 text-emerald-300"
                        : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100",
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-4.5 w-4.5 transition-colors",
                        active ? "text-emerald-400" : "text-zinc-500 group-hover:text-zinc-300",
                      )}
                    />
                    {item.label}
                    {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400" />}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-zinc-800/70 p-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
          <p className="text-xs font-semibold text-zinc-200">Aurora & Oak</p>
          <p className="mt-0.5 text-[11px] text-zinc-500">Shopify · connected</p>
          <div className="mt-2.5 flex items-center gap-1.5">
            <span className={cn("h-1.5 w-1.5 rounded-full", demoMode ? "bg-amber-400" : "bg-emerald-400", "animate-pulse-dot")} />
            <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              {demoMode ? "Demo mode" : "Live sync"}
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
