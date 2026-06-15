import type { Metadata } from "next";
import Link from "next/link";
import { BookOpenCheck, Search } from "lucide-react";
import { navItems } from "@/lib/constants";
import "./globals.css";

export const metadata: Metadata = {
  title: "TradeForge Journal",
  description: "A low-friction personal trading journal and learning system.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-forge-line bg-white">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <Link href="/" className="flex items-center gap-2 text-lg font-semibold">
                <BookOpenCheck className="h-5 w-5 text-forge-green" aria-hidden="true" />
                TradeForge Journal
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
            <nav className="flex gap-1 overflow-x-auto pb-1">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-forge-muted transition hover:bg-forge-panel hover:text-forge-ink"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
