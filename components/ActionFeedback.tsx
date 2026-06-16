"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Info, X } from "lucide-react";

export function ActionFeedback() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const message = searchParams.get("feedback");
  const type = searchParams.get("feedbackType") ?? "success";
  const [visible, setVisible] = useState(Boolean(message));

  const cleanUrl = useMemo(() => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("feedback");
    nextParams.delete("feedbackType");
    const query = nextParams.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);

  useEffect(() => {
    if (!message) return;
    setVisible(true);
    const timer = window.setTimeout(() => {
      setVisible(false);
      router.replace(cleanUrl, { scroll: false });
    }, 3200);
    return () => window.clearTimeout(timer);
  }, [cleanUrl, message, router]);

  if (!message || !visible) return null;

  const isSuccess = type === "success";
  const Icon = isSuccess ? CheckCircle2 : Info;

  return (
    <div className="fixed right-4 top-4 z-50 w-[min(380px,calc(100vw-2rem))] rounded-lg border border-forge-line bg-white p-3 shadow-lg">
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-5 w-5 ${isSuccess ? "text-forge-green" : "text-forge-blue"}`} aria-hidden="true" />
        <p className="flex-1 text-sm font-medium text-forge-ink">{message}</p>
        <button
          type="button"
          className="rounded-md p-1 text-forge-muted hover:bg-forge-panel hover:text-forge-ink"
          aria-label="Dismiss message"
          onClick={() => {
            setVisible(false);
            router.replace(cleanUrl, { scroll: false });
          }}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
