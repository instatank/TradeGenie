import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BookOpenCheck, Search } from "lucide-react";
import { ActionFeedback } from "@/components/ActionFeedback";
import { MoreNav } from "@/components/MoreNav";
import { NavLinks } from "@/components/NavLinks";
import { moreNavItems, primaryNavItems } from "@/lib/constants";
import "./globals.css";

export const metadata: Metadata = {
  title: "TradeGenie",
  description: "A low-friction personal trading journal and learning system.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Suspense fallback={null}>
          <ActionFeedback />
        </Suspense>
        <header className="sticky top-0 z-40 border-b border-forge-line bg-white/85 backdrop-blur">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <Link href="/" className="flex items-center gap-2">
                <BookOpenCheck className="h-5 w-5 text-forge-green" aria-hidden="true" />
                <span className="flex flex-col leading-tight">
                  <span className="text-lg font-semibold">TradeGenie</span>
                  <span className="text-xs font-medium text-forge-muted">magic journal</span>
                </span>
              </Link>
              <form action="/search" className="relative w-full lg:max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-forge-muted" aria-hidden="true" />
                <input
                  name="q"
                  type="search"
                  placeholder="Search trades, notes, lessons..."
                  className="input w-full pl-9"
                />
              </form>
            </div>
            <nav className="flex flex-wrap items-center gap-1 pb-1">
              <NavLinks items={primaryNavItems} />
              <MoreNav items={moreNavItems} />
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
