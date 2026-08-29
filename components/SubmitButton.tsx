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
  formAction,
}: {
  children: ReactNode;
  /** Shown instead of the label while the action runs. */
  pendingLabel?: string;
  /** The resting icon. Replaced by a spinner while pending. */
  icon?: ReactNode;
  className?: string;
  disabled?: boolean;
  /** A different action for this button, when one form offers two (the
   *  unjournaled list's checkboxes drive both "log as archive" and "dismiss").
   *  A server action passed through as a reference, which is why this button
   *  must never also carry a `name` — React rejects that combination. */
  formAction?: (formData: FormData) => void | Promise<void>;
}) {
  const { pending } = useFormStatus();

  return (
    <button className={className} type="submit" formAction={formAction} disabled={disabled || pending} aria-busy={pending}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : icon}
      {pending ? (pendingLabel ?? children) : children}
    </button>
  );
}
