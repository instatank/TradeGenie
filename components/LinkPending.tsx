"use client";

import { useLinkStatus } from "next/link";

// A tap that does nothing for two seconds reads as a tap that failed. This is
// the whole of the feedback the root `app/loading.tsx` skeleton used to give,
// minus the Suspense boundary that came with it — see the decisions log entry
// "Same-route filter links were dead": any loading boundary above a page makes
// every same-route, different-searchParams navigation (view tabs, pagination,
// saved views, the trades search box, the toast cleanup) hang forever in
// Next 15.5.
//
// `useLinkStatus` reports the pending state of the enclosing <Link> only, so
// this must be rendered as a CHILD of the link it speaks for.
export function LinkPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      role="status"
      aria-label="Loading"
      className="ml-1.5 inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent align-[-1px] opacity-70"
    />
  );
}
