"use client";

// ─── Admin console tab shell ──────────────────────────────────────────────────
// Brutalist tab strip: 1px frame, uppercase kickers, signal-red active rail.
// Each tab's content is rendered on the server and passed in as a slot, so
// switching tabs is pure client-side visibility — no extra fetches.

import { useState } from "react";
import { cn } from "@/lib/utils";

export interface AdminTab {
  id: string;
  label: string;
  content: React.ReactNode;
}

export function AdminTabs({ tabs }: { tabs: AdminTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");

  return (
    <div className="space-y-6">
      {/* Tab strip */}
      <div className="flex flex-wrap gap-0 border border-white" role="tablist">
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(tab.id)}
              className={cn(
                "type-kicker relative flex-1 whitespace-nowrap px-4 py-3 text-center transition-colors duration-100 sm:flex-none sm:min-w-40",
                isActive
                  ? "bg-accent text-white"
                  : "bg-black text-zinc-400 hover:bg-zinc-900 hover:text-white",
              )}
            >
              {tab.label}
              {/* Signal-red active rail */}
              <span
                className={cn(
                  "absolute inset-x-0 bottom-0 h-0.5 bg-accent transition-opacity duration-100",
                  isActive ? "opacity-100" : "opacity-0",
                )}
              />
            </button>
          );
        })}
      </div>

      {/* Active panel */}
      {tabs.map((tab) => (
        <div key={tab.id} role="tabpanel" hidden={tab.id !== active} className="animate-fade-in">
          {tab.content}
        </div>
      ))}
    </div>
  );
}
