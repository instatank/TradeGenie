"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { saveQuickNoteAction } from "@/app/actions";

// The Today capture bar: one line, type, Enter, saved. Modelled on the
// time-tracker's quick-capture bar down to the shape — a 38px pill with a
// borderless input and a send button that stays muted until there's something
// to save, so dictation and paste have a guaranteed save path that isn't the
// Enter key.
//
// Long-press (420ms, the time-tracker's LONG_PRESS_MS) or double-click promotes
// the thought to its home page — the day's review — where the full box and Save
// button live. Anything already typed rides along in the URL, so the gesture
// never costs you a thought.
//
// It ships client JS for the same reason TagPicker does: a press-and-hold
// gesture cannot be expressed as a plain form. Everything else here is still a
// server form — with JS off, typing and pressing Enter (or the arrow) saves
// exactly as it does now; only the shortcut gesture is lost.

const LONG_PRESS_MS = 420;

export function QuickNoteBar({
  date,
  redirectTo,
  homeHref,
  noteCount,
}: {
  /** yyyy-MM-dd — the day this note is filed under. */
  date: string;
  redirectTo: string;
  /** Where the gesture goes: the day's review, which is these notes' home. */
  homeHref: string;
  noteCount: number;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [hasText, setHasText] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);

  function openHome() {
    const typed = inputRef.current?.value.trim() ?? "";
    if (inputRef.current) inputRef.current.value = "";
    setHasText(false);
    router.push(`${homeHref}${typed ? `&note=${encodeURIComponent(typed)}` : ""}#quick-note`);
  }

  function startPress() {
    fired.current = false;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      fired.current = true;
      try {
        navigator.vibrate?.(15);
      } catch {
        // Haptics are a nicety; a browser without them changes nothing.
      }
      openHome();
    }, LONG_PRESS_MS);
  }

  function endPress(event: React.PointerEvent) {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    // The long press already navigated — swallow the tap so the bar doesn't
    // refocus behind the page we just left.
    if (fired.current) event.preventDefault();
  }

  function cancelPress() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }

  return (
    <form action={saveQuickNoteAction} className="flex items-center gap-2">
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="redirectTo" value={redirectTo} />

      <div className="flex h-10 flex-1 items-center rounded-full border border-forge-line bg-white px-3 transition focus-within:border-forge-blue focus-within:ring-2 focus-within:ring-forge-blue/15">
        <input
          ref={inputRef}
          name="text"
          type="text"
          autoComplete="off"
          placeholder="Capture a thought — Enter to save"
          title="Type to capture · hold or double-click to open the full note in your day's review"
          aria-label="Quick note"
          // text-base is the iOS focus-zoom guard; touch-callout-none stops the
          // native long-press menu from hijacking our own gesture.
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-base text-forge-ink outline-none [touch-action:manipulation] [-webkit-touch-callout:none] placeholder:text-sm placeholder:text-forge-muted"
          onInput={(event) => setHasText(Boolean(event.currentTarget.value.trim()))}
          onDoubleClick={openHome}
          onPointerDown={startPress}
          onPointerUp={endPress}
          onPointerCancel={cancelPress}
          onPointerLeave={cancelPress}
        />
        <button
          type="submit"
          aria-label="Save note"
          title="Save note"
          className={`ml-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition active:scale-95 ${
            hasText ? "bg-forge-blue text-white" : "bg-forge-panel text-forge-muted"
          }`}
        >
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {noteCount ? (
        <a href={homeHref} className="shrink-0 text-xs text-forge-muted transition hover:text-forge-blue">
          {noteCount} note{noteCount === 1 ? "" : "s"} today →
        </a>
      ) : null}
    </form>
  );
}
