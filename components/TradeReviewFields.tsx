import { BigChoice, ChipRadioGroup } from "@/components/Chips";
import { OptionChipCheckbox } from "@/components/OptionField";

export type ReviewMistakeTag = { id: string; label: string; description?: string | null };

export type ReviewableTrade = {
  status: string;
  exitPrice: number | null;
  realizedPnl: number | null;
  followedPlan: string | null;
  entryGrade: string | null;
  lesson: string | null;
  exitReason: string | null;
};

// The one-minute review ritual, shared by the trade page and the inline review
// inside an expanded row on /trades — same fields, same names, same action, so
// reviewing from either place produces exactly the same record.
export function TradeReviewFields({
  trade,
  mistakeTags,
  selectedMistakes,
  compact = false,
}: {
  trade: ReviewableTrade;
  mistakeTags: ReviewMistakeTag[];
  selectedMistakes: string[];
  compact?: boolean;
}) {
  return (
    <>
      <input type="hidden" name="shownMistakeTagIds" value={mistakeTags.map((tag) => tag.id).join(",")} />

      <ChipRadioGroup
        label="Where does this trade stand?"
        name="status"
        options={[
          { value: "CLOSED", label: "Closed" },
          { value: "OPEN", label: "Still open" },
          { value: "IDEA", label: "Just an idea" },
          { value: "CANCELLED", label: "Cancelled" },
        ]}
        defaultValue={trade.status}
        toneByValue={{ CLOSED: "neutral", OPEN: "blue" }}
      />

      <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
        <label className="field">
          <span className="text-xs font-medium text-forge-muted">Exit price</span>
          <input name="exitPrice" type="number" step="any" defaultValue={trade.exitPrice ?? ""} className="input" />
        </label>
        <label className="field">
          <span className="text-xs font-medium text-forge-muted">Realized P&L</span>
          <input name="realizedPnl" type="number" step="any" defaultValue={trade.realizedPnl ?? ""} className="input" />
        </label>
      </div>

      <ChipRadioGroup
        label="Did you follow your plan?"
        name="followedPlan"
        options={[
          { value: "YES", label: "Yes" },
          { value: "PARTIAL", label: "Partly" },
          { value: "NO", label: "No" },
        ]}
        defaultValue={trade.followedPlan && trade.followedPlan !== "NA" ? trade.followedPlan : undefined}
        toneByValue={{ YES: "green", PARTIAL: "gold", NO: "red" }}
        hint={compact ? undefined : "Judge the plan, not the P&L. A rule-following loss is a good trade."}
      />

      <BigChoice
        label="Grade the execution"
        name="entryGrade"
        options={[
          { value: "A", label: "A", hint: compact ? undefined : "followed my rules" },
          { value: "B", label: "B", hint: compact ? undefined : "minor slip" },
          { value: "C", label: "C", hint: compact ? undefined : "broke my rules" },
        ]}
        defaultValue={trade.entryGrade && trade.entryGrade !== "NA" ? trade.entryGrade : undefined}
        toneByValue={{ A: "green", B: "gold", C: "red" }}
      />

      {/* The execution-mistake vocabulary is the trader's, not ours: anything
          typed in the box becomes a real mistake tag on save (and a chip from
          then on), so a habit we never thought of can still be counted. */}
      <OptionChipCheckbox
        label="Any of these happen? (tap all that apply)"
        name="mistakeTagId"
        choices={mistakeTags.map((tag) => ({ value: tag.id, label: tag.label, hint: tag.description ?? undefined }))}
        selected={selectedMistakes}
        placeholder="add your own, e.g. moved target…"
        hint={compact
          ? "Not on the list? Type it — it becomes a chip from next time."
          : "Not on the list? Type it — commas separate several. It becomes a chip here from next time, and counts in your analytics like any other."}
      />

      <label className="field">
        <span className="label">The one lesson from this trade</span>
        <input name="lesson" defaultValue={trade.lesson ?? ""} placeholder="e.g. wait for the candle to close before entering" className="input" />
        <span className="text-xs text-forge-muted">Saved to your lessons list automatically, so it resurfaces before future trades.</span>
      </label>

      <details className="rounded-lg border border-forge-line p-3" open={Boolean(trade.exitReason)}>
        <summary className="cursor-pointer text-sm font-semibold text-forge-muted">What happened at the exit? (optional)</summary>
        <textarea name="exitReason" rows={3} defaultValue={trade.exitReason ?? ""} className="textarea mt-3 min-h-20 w-full" />
      </details>
    </>
  );
}
