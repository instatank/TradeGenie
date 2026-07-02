"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Primary nav with an active-page highlight so you always know where you are.
export function NavLinks({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <>
      {items.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition ${
              active ? "bg-forge-ink text-white" : "text-forge-muted hover:bg-forge-panel hover:text-forge-ink"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
