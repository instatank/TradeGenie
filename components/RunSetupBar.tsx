import Link from "next/link";
import { ClipboardCheck } from "lucide-react";

// The way into the pre-trade checklist, offered wherever you'd normally log a
// trade. One tap per model, and only models that actually have a checklist —
// a setup with nothing to tick would be a dead end.
//
// It sits *beside* the quick log rather than replacing it: the 30-second path
// has to stay 30 seconds. This is the slower, deliberate one, for when you're
// standing in front of a setup and want to check it before you press the button.
export function RunSetupBar({ setups }: { setups: Array<{ id: string; name: string; stepCount: number }> }) {
  if (!setups.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-forge-line pt-3">
      <span className="inline-flex items-center gap-1.5 text-xs text-forge-muted">
        <ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" />
        Following a model? Check it first:
      </span>
      {setups.map((setup) => (
        <Link
          key={setup.id}
          href={`/playbook/${setup.id}/run`}
          className="rounded-full border border-forge-blue/40 bg-sky-50 px-3 py-1 text-sm font-medium text-forge-blue transition hover:border-forge-blue hover:bg-sky-100"
        >
          {setup.name}
          <span className="ml-1 text-xs font-normal text-forge-blue/70">{setup.stepCount} step{setup.stepCount === 1 ? "" : "s"}</span>
        </Link>
      ))}
    </div>
  );
}
