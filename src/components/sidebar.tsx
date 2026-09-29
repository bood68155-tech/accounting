"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { Logo } from "@/components/logo";
import {
  IconDashboard,
  IconLedger,
  IconOrders,
  IconReport,
  IconSettings,
  IconSparkles,
  IconStore,
  IconUsers,
  IconX,
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
      { href: "/reports/balance-sheet", label: "Balance Sheet", icon: IconReport },
      { href: "/products", label: "Products & COGS", icon: IconDashboard },
      { href: "/assistant", label: "AI Assistant", icon: IconSparkles },
    ],
  },
  {
    section: "Platform",
    items: [{ href: "/admin", label: "Admin", icon: IconUsers }],
  },
  {
    section: "Settings",
    items: [{ href: "/settings", label: "Settings", icon: IconSettings }],
  },
];

function isActiveHref(pathname: string, href: string) {
  return href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
      {NAV.map((group) => (
        <div key={group.section}>
          <p className="type-kicker mb-2 px-3 text-zinc-600">{group.section}</p>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActiveHref(pathname, item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    "group relative flex items-center gap-3 px-3 py-2 text-sm font-medium uppercase tracking-[0.04em] transition-colors duration-100",
                    active
                      ? "bg-zinc-900 text-white"
                      : "text-zinc-400 hover:bg-zinc-900 hover:text-white",
                  )}
                >
                  {/* Active indicator — signal red rail */}
                  <span
                    className={cn(
                      "absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 bg-accent transition-opacity duration-100",
                      active ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <Icon
                    className={cn(
                      "h-4.5 w-4.5 shrink-0 transition-colors duration-100",
                      active ? "text-accent" : "text-zinc-500 group-hover:text-white",
                    )}
                  />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function TenantFooter({ tenantName }: { tenantName: string }) {
  const router = useRouter();

  return (
    <div className="border-t border-white p-3">
      <div className="border border-white p-3">
        <p className="truncate text-xs font-bold uppercase tracking-[0.06em] text-white">{tenantName}</p>
        <p className="mt-0.5 text-[11px] text-zinc-500">Isolated tenant workspace</p>
        <div className="mt-2.5 flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 bg-accent animate-pulse-dot" />
          <span className="type-kicker text-zinc-500">Live sync</span>
          <button
            type="button"
            onClick={() =>
              signOut({ redirect: false }).then(() => {
                router.push("/login");
                router.refresh();
              })
            }
            className="type-kicker ml-auto text-zinc-500 transition-colors duration-100 hover:text-accent"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

export function Sidebar({ tenantName }: { tenantName: string }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <>
      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-white bg-black md:flex">
        <div className="flex h-16 items-center border-b border-white px-5">
          <Link href="/dashboard" className="transition-opacity duration-100 hover:opacity-70">
            <Logo />
          </Link>
        </div>
        <SidebarNav />
        <TenantFooter tenantName={tenantName} />
      </aside>

      {/* Mobile top bar with menu trigger */}
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-white bg-black px-4 md:hidden">
        <button
          type="button"
          aria-label="Open navigation"
          onClick={() => setMobileOpen(true)}
          className="flex h-9 w-9 items-center justify-center border border-white text-white transition-colors duration-100 hover:bg-white hover:text-black"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <Link href="/dashboard" className="transition-opacity duration-100 hover:opacity-70">
          <Logo size={24} />
        </Link>
        <span className="h-9 w-9" aria-hidden />
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="animate-fade-in absolute inset-0 bg-black/80"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="animate-drawer-in absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-white bg-black shadow-[8px_0_0_0_rgba(255,59,0,0.9)]">
            <div className="flex h-14 items-center justify-between border-b border-white px-4">
              <Logo size={26} />
              <button
                type="button"
                aria-label="Close navigation"
                onClick={() => setMobileOpen(false)}
                className="flex h-8 w-8 items-center justify-center text-zinc-400 transition-colors duration-100 hover:bg-zinc-900 hover:text-white"
              >
                <IconX className="h-4 w-4" />
              </button>
            </div>
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
            <TenantFooter tenantName={tenantName} />
          </aside>
        </div>
      )}
    </>
  );
}
