"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

// A submit button that says it is working.
//
// The exchange sync takes several seconds — it pages the whole account — and a
// button that looks identical before and during is indistinguishable from one
// that did nothing. That ambiguity makes people press it twice, which is how
// you end up with two syncs racing each other.
//
// Same mechanism as SaveBar: useFormStatus reads the pending state of the form
// this button sits inside, so there is no state to wire up and nothing to keep
// in sync. It must be its own client component because useFormStatus only
// reports on a form it is rendered *inside* — reading it from the page would
// always return false.
export function SubmitButton({
  children,
  pendingLabel,
  icon,
  className = "button",
  disabled = false,
}: {
  children: ReactNode;
  /** Shown instead of the label while the action runs. */
  pendingLabel?: string;
  /** The resting icon. Replaced by a spinner while pending. */
  icon?: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button className={className} type="submit" disabled={disabled || pending} aria-busy={pending}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : icon}
      {pending ? (pendingLabel ?? children) : children}
    </button>
  );
}
