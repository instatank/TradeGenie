import { createTradeAction } from "@/app/actions";
import { PageTitle, SelectField, TextAreaField, TextField } from "@/components/Fields";
import { directions, emotionalStates, entryGrades, marketTypes, riskPostures, tradeStatuses } from "@/lib/constants";
import { getSettings } from "@/lib/settings-store";

export default async function NewTradePage() {
  const settings = await getSettings();
  return (
    <main className="page-shell max-w-3xl">
      <PageTitle title="Quick trade note" subtitle="Only four fields are required. Capture the idea before the details get fuzzy." />
      <form action={createTradeAction} className="panel space-y-4" encType="multipart/form-data">
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Instrument" name="instrument" required placeholder="BTC, SOL, NIFTY" />
          <SelectField label="Direction" name="direction" options={directions} defaultValue="UNKNOWN" />
          <SelectField label="Status" name="status" options={tradeStatuses} defaultValue="IDEA" />
        </div>
        <TextAreaField label="Entry thesis" name="entryThesis" required placeholder="Why this trade, why now?" rows={4} />

        <details className="rounded-lg border border-forge-line p-3" open>
          <summary className="cursor-pointer text-sm font-semibold">Optional context</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <SelectField label="Market type" name="marketType" options={marketTypes} defaultValue={settings.defaultMarketType} />
            <TextField label="Setup name" name="setupName" />
            <TextAreaField label="Invalidation" name="invalidation" rows={3} />
            <TextAreaField label="Concern" name="concern" rows={3} />
            <SelectField label="Emotional state" name="emotionalState" options={emotionalStates} includeBlank />
            <SelectField label="Risk posture" name="riskPosture" options={riskPostures} includeBlank />
            <TextField label="Confidence score" name="confidenceScore" type="number" />
            <SelectField label="Entry grade" name="entryGrade" options={entryGrades} defaultValue="NA" />
            <label className="field sm:col-span-2">
              <span className="label">Screenshot upload</span>
              <input className="input" type="file" name="screenshot" accept="image/*" />
            </label>
          </div>
        </details>

        <details className="rounded-lg border border-forge-line p-3">
          <summary className="cursor-pointer text-sm font-semibold">Advanced objective fields</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <TextField label="Entry price" name="entryPrice" type="number" step="0.01" />
            <TextField label="Stop price" name="stopPrice" type="number" step="0.01" />
            <TextField label="Target price" name="targetPrice" type="number" step="0.01" />
            <TextField label="Quantity / size" name="quantity" type="number" step="any" />
            <TextField label="Total order value" name="totalOrderValue" type="number" step="0.01" />
            <TextField label="Leverage" name="leverage" type="number" />
          </div>
          <p className="mt-3 text-sm text-forge-muted">
            Enter quantity and price to calculate order value, or order value and price to calculate quantity.
          </p>
        </details>

        <button className="button" type="submit">Save trade note</button>
      </form>
    </main>
  );
}
