"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Coins, LayoutDashboard, LineChart, Mic, NotebookPen } from "lucide-react";
import type { ComponentType } from "react";

// Phone-only bottom tab bar for the daily loop (DayOS pattern: a few thumb-zone
// tabs, everything else under "More" in the header). Hidden on lg+ where the
// in-header nav takes over. Icons are mapped here so lib/constants stays plain.
const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  "/": LayoutDashboard,
  "/inbox": Mic,
  "/trades": LineChart,
  "/assets": Coins,
  "/daily": NotebookPen,
};

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function MobileNav({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-forge-line bg-white/95 backdrop-blur pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {items.map((item) => {
        const Icon = ICONS[item.href] ?? LayoutDashboard;
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition ${
              active ? "text-forge-blue" : "text-forge-muted"
            }`}
          >
            <Icon className="h-5 w-5" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
