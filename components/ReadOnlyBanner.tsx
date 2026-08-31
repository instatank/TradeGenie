"use client";

import { useEffect, useState } from "react";
import { Eye } from "lucide-react";

// Deliberately a client component reading the non-secret "tg_role" cookie
// (see SaveBar.tsx's isReadOnlyViewer for the same check) rather than a
// server component reading it via next/headers cookies(). This banner sits
// in the root layout, which wraps every page — a server-side cookies() read
// there would mark every route dynamic and undo the static prerendering the
// "Page-load latency" work already won (verified: with SITE_PASSWORD set,
// `next build` turned `/`, `/analytics`, `/assets`, `/calculator`,
// `/mechanisms` and `/playbook` from ○ Static back to ƒ Dynamic the moment
// this read cookies() at build time). The cost is a brief flash-in after
// hydration instead of being present on the very first paint — an acceptable
// trade for not re-breaking a page-load fix already shipped once.
export function ReadOnlyBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(document.cookie.split("; ").some((entry) => entry === "tg_role=viewer"));
  }, []);

  if (!visible) return null;

  return (
    <div className="flex items-center justify-center gap-2 bg-forge-blue/10 px-3 py-1.5 text-center text-xs font-medium text-forge-blue">
      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
      Viewing in read-only mode — nothing you do here gets saved.
    </div>
  );
}
