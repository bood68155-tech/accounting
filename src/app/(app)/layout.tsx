import { Sidebar } from "@/components/sidebar";
import { isDemoMode } from "@/lib/data/config";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-[#0b0d10]">
      <Sidebar demoMode={isDemoMode()} />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
