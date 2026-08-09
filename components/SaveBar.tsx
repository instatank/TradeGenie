"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Loader2 } from "lucide-react";

// The single save control for a page-sized form. It lives inside the <form> it
// saves, watches it for edits, and makes losing work basically impossible:
//   - it says out loud when there are unsaved changes,
//   - Cmd/Ctrl+S saves without reaching for the mouse,
//   - leaving the page (tab close or an in-app link) asks first while dirty.
// Rendering it first inside the form also makes it the form's default submit
// button, so pressing Enter in any field saves everything instead of firing
// whatever destructive button happened to come first in the markup.
export function SaveBar({
  label = "Save",
  hint,
  children,
}: {
  label?: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  const anchor = useRef<HTMLDivElement>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form) return;
    const markDirty = () => setDirty(true);
    const markClean = () => setDirty(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        form.requestSubmit();
      }
    };
    form.addEventListener("input", markDirty);
    form.addEventListener("change", markDirty);
    form.addEventListener("submit", markClean);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      form.removeEventListener("input", markDirty);
      form.removeEventListener("change", markDirty);
      form.removeEventListener("submit", markClean);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warnOnUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    // beforeunload doesn't fire for client-side <Link> navigation, so catch
    // those clicks too — this is where edits used to disappear.
    const warnOnLinkClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
      const link = (event.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.getAttribute("href")?.startsWith("#")) return;
      if (!window.confirm("You have unsaved changes on this page. Leave without saving?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warnOnUnload);
    document.addEventListener("click", warnOnLinkClick, true);
    return () => {
      window.removeEventListener("beforeunload", warnOnUnload);
      document.removeEventListener("click", warnOnLinkClick, true);
    };
  }, [dirty]);

  // Fixed to the bottom of the screen: the save button is always one tap away,
  // whatever you are editing and however far down the page you have scrolled.
  return (
    <div ref={anchor} className="fixed inset-x-0 bottom-0 z-30 px-3 pb-3">
      <div
        className={`mx-auto flex w-full max-w-5xl flex-wrap items-center gap-3 rounded-xl border bg-white/95 px-3 py-2 shadow-lg backdrop-blur transition ${
          dirty ? "border-forge-blue" : "border-forge-line"
        }`}
      >
        <button className="button min-h-9" type="submit" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
          {pending ? "Saving…" : label}
        </button>
        <span className={`text-xs ${dirty ? "font-medium text-forge-blue" : "text-forge-muted"}`}>
          {pending ? "Saving everything on this page…" : dirty ? "Unsaved changes — one save captures all of them." : hint ?? "Saves everything on this page at once."}
        </span>
        {children ? <div className="ml-auto flex items-center gap-2">{children}</div> : null}
      </div>
    </div>
  );
}
