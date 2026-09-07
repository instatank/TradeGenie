"use client";

import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";

/**
 * Attach charts to whatever this form saves.
 *
 * The control that matters is the plain `<input type="file" multiple>` — it is
 * a real form field, so with JavaScript off this is exactly the picker the
 * trades page already had, and the server reads it the same way either way.
 * Everything else here is enhancement on top of it.
 *
 * The enhancement is the reason this exists at all. A TradingView screenshot
 * lands on the clipboard; a file picker means save-to-disk, find-the-folder,
 * browse — which blows the note-writing budget every time and is why charts
 * mostly did not get attached. Ctrl/Cmd+V, or a drop, writes straight into the
 * input's `files` via a DataTransfer, so the browser submits them as if they
 * had been browsed for.
 *
 * This is the fourth client-JS control in the app, after TagPicker, the
 * calculator and the quick-note bar, and for the same kind of reason: a
 * clipboard read cannot be expressed as a plain form.
 */
export function ScreenshotField({
  name,
  label = "Charts",
  hint,
}: {
  name: string;
  label?: string;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [names, setNames] = useState<string[]>([]);
  const [armed, setArmed] = useState(false);

  /** The input's FileList is read-only, so the only way to add to it is to
   *  rebuild one. DataTransfer is the standard trick and is what keeps the
   *  submitted payload identical to a browsed selection. */
  function put(files: File[]) {
    const input = inputRef.current;
    if (!input) return;
    const carrier = new DataTransfer();
    for (const file of files) carrier.items.add(file);
    input.files = carrier.files;
    setNames(files.map((file) => file.name));
  }

  function add(incoming: File[]) {
    const images = incoming.filter((file) => file.type.startsWith("image/"));
    if (!images.length) return;
    // Renamed on the way in: every clipboard paste arrives as "image.png", so
    // three pasted charts would otherwise be three identical-looking rows with
    // no way to tell which is which before saving.
    const stamped = images.map((file) =>
      file.name && file.name !== "image.png"
        ? file
        : new File([file], `chart-${new Date().toISOString().replace(/[:.]/g, "-")}.${file.type.split("/")[1] || "png"}`, {
            type: file.type,
          }),
    );
    put([...(inputRef.current?.files ? Array.from(inputRef.current.files) : []), ...stamped]);
  }

  function clear() {
    const input = inputRef.current;
    if (input) input.value = "";
    setNames([]);
  }

  return (
    <div className="field">
      <span className="label">{label}</span>
      <div
        // Paste is captured on the wrapper rather than the window: two of these
        // can be on one page (a note's fold and the composer), and a
        // window-level listener would make a paste land in whichever one
        // registered last instead of the one being typed in.
        onPaste={(event) => {
          const files = Array.from(event.clipboardData?.files ?? []);
          if (!files.length) return;
          event.preventDefault();
          add(files);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setArmed(true);
        }}
        onDragLeave={() => setArmed(false)}
        onDrop={(event) => {
          event.preventDefault();
          setArmed(false);
          add(Array.from(event.dataTransfer?.files ?? []));
        }}
        // Focusable so a keyboard paste has somewhere to land without a click.
        tabIndex={0}
        className={`rounded-lg border border-dashed p-3 transition ${
          armed ? "border-forge-blue bg-sky-50" : "border-forge-line bg-white/60"
        }`}
      >
        <div className="flex items-center gap-2 text-sm text-forge-muted">
          <ImagePlus className="h-4 w-4 shrink-0 text-forge-blue" aria-hidden="true" />
          <span>Click here and paste (Ctrl/Cmd+V), drop an image, or browse below.</span>
        </div>
        <input ref={inputRef} className="input mt-2 w-full" type="file" name={name} accept="image/*" multiple onChange={(event) => setNames(Array.from(event.target.files ?? []).map((file) => file.name))} />
        {names.length ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {names.map((fileName) => (
              <span key={fileName} className="rounded-md bg-forge-panel px-2 py-0.5 text-xs">{fileName}</span>
            ))}
            <button type="button" onClick={clear} className="flex items-center gap-1 text-xs text-forge-muted hover:text-forge-red">
              <X className="h-3 w-3" aria-hidden="true" />
              Clear
            </button>
          </div>
        ) : null}
      </div>
      {hint ? <p className="mt-1 text-xs text-forge-muted">{hint}</p> : null}
    </div>
  );
}
