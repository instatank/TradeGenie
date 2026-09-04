import { collectionNames, restoreRecords, storageStatus, type CollectionName } from "@/lib/store";
import { defaultSettings, getSettings, saveSettings, type AppSettings } from "@/lib/settings-store";
import { listRecords } from "@/lib/store";

// ONE definition of "a backup of this journal", used by every path that makes
// one: the /api/export download, the "Back up now" button, and the nightly
// cron. Same reasoning as one tag tokenizer and one search index — the moment
// two places decide what a backup contains, one of them starts leaving
// something out. /api/export had already been that bug once: it carried a
// hardcoded collection list that silently dropped assets and asset notes.
//
// The other half — restoreSnapshot — is the piece that did not exist at all.
// Before this, a backup file was a one-way dump: nothing in the app could read
// one back in, so "we have backups" was true and "we can recover" was not.

/** Bumped only if the shape below changes in a way a reader must know about.
 *  restoreSnapshot refuses a version it was not written to understand rather
 *  than guessing at an unfamiliar file. */
export const BACKUP_FORMAT_VERSION = 1;

export type BackupSnapshot = {
  formatVersion: number;
  exportedAt: string;
  /** Which deployment wrote it. Answers "what code produced this file?" months
   *  later, when that is the only question that matters about a bad restore. */
  appCommit: string | null;
  storageMode: string;
  durable: boolean;
  /** Per-collection record counts, written into the file rather than derived on
   *  read: the shrink guard compares against the LAST backup, and re-walking a
   *  previous snapshot's arrays just to count them is work with no purpose. */
  counts: Record<string, number>;
  totalRecords: number;
  settings: AppSettings;
  data: Record<string, unknown[]>;
};

export async function buildSnapshot(): Promise<BackupSnapshot> {
  const data: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  let totalRecords = 0;

  for (const collection of collectionNames) {
    const records = (await listRecords(collection)) as unknown[];
    data[collection] = records;
    counts[collection] = records.length;
    totalRecords += records.length;
  }

  const status = storageStatus();
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    appCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    storageMode: status.mode,
    durable: status.durable,
    counts,
    totalRecords,
    settings: await getSettings(),
    data,
  };
}

export function snapshotFileName(at = new Date()) {
  const stamp = at.toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  return `tradegenie-backup-${stamp}.json`;
}

// ---------------------------------------------------------------------------
// Reading one back in
// ---------------------------------------------------------------------------

export type RestoreMode =
  /** Write only records whose id is not already present. Cannot destroy
   *  anything, which is why it is the default: the overwhelmingly common
   *  restore is "the database is empty, put my journal back". */
  | "fill-gaps"
  /** Write every record in the file, overwriting a same-id record that is
   *  already there. This is a genuine rollback and it DOES discard edits made
   *  since the backup, so it is never the default and the UI says so. */
  | "overwrite";

export type RestorePlanIssue = { kind: "unknown-collection" | "bad-record"; detail: string };

export type RestorePreview = {
  formatVersion: number;
  exportedAt: string | null;
  totalRecords: number;
  counts: Record<string, number>;
  hasSettings: boolean;
  issues: RestorePlanIssue[];
};

export type RestoreReport = {
  written: Record<string, number>;
  skipped: Record<string, number>;
  totalWritten: number;
  totalSkipped: number;
  settingsRestored: boolean;
  issues: RestorePlanIssue[];
};

export class BackupFormatError extends Error {}

type ParsedRecords = { records: RestorableRecord[]; issues: RestorePlanIssue[] };
type RestorableRecord = { id: string } & Record<string, unknown>;

/** Turns unknown JSON into something we are willing to write, or throws with a
 *  reason a non-technical owner can act on. Deliberately strict about the
 *  envelope and forgiving about the contents: a file from a future version of
 *  the app may carry a collection this build has never heard of, and dropping
 *  that with a note is better than refusing the whole restore. */
export function parseSnapshot(raw: unknown): { snapshot: BackupSnapshot; issues: RestorePlanIssue[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BackupFormatError("That file isn't a TradeGenie backup — it doesn't contain a backup object.");
  }
  const candidate = raw as Partial<BackupSnapshot>;
  if (!candidate.data || typeof candidate.data !== "object" || Array.isArray(candidate.data)) {
    throw new BackupFormatError("That file isn't a TradeGenie backup — it has no `data` section.");
  }
  const version = typeof candidate.formatVersion === "number" ? candidate.formatVersion : 1;
  if (version > BACKUP_FORMAT_VERSION) {
    throw new BackupFormatError(
      `This backup was written by a newer version of TradeGenie (format ${version}; this build reads ${BACKUP_FORMAT_VERSION}). Update the app before restoring it.`,
    );
  }

  const issues: RestorePlanIssue[] = [];
  const data: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  let totalRecords = 0;

  const known = new Set<string>(collectionNames);
  for (const [name, value] of Object.entries(candidate.data)) {
    if (!known.has(name)) {
      issues.push({ kind: "unknown-collection", detail: `Skipped "${name}" — this version of the app has no such collection.` });
      continue;
    }
    if (!Array.isArray(value)) {
      issues.push({ kind: "unknown-collection", detail: `Skipped "${name}" — expected a list of records.` });
      continue;
    }
    const parsed = takeRecords(name, value);
    issues.push(...parsed.issues);
    data[name] = parsed.records;
    counts[name] = parsed.records.length;
    totalRecords += parsed.records.length;
  }

  const snapshot: BackupSnapshot = {
    formatVersion: version,
    exportedAt: typeof candidate.exportedAt === "string" ? candidate.exportedAt : new Date().toISOString(),
    appCommit: typeof candidate.appCommit === "string" ? candidate.appCommit : null,
    storageMode: typeof candidate.storageMode === "string" ? candidate.storageMode : "unknown",
    durable: candidate.durable === true,
    counts,
    totalRecords,
    settings: mergeRestoredSettings(candidate.settings),
    data,
  };
  return { snapshot, issues };
}

function takeRecords(collection: string, value: unknown[]): ParsedRecords {
  const records: RestorableRecord[] = [];
  const issues: RestorePlanIssue[] = [];
  let dropped = 0;
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      dropped += 1;
      continue;
    }
    const id = (entry as { id?: unknown }).id;
    // An id is not optional: every write path in this app keys on it, and a
    // record without one could not be matched against what is already stored,
    // so "fill gaps" could not tell a duplicate from a new record.
    if (typeof id !== "string" || !id) {
      dropped += 1;
      continue;
    }
    records.push({ ...(entry as Record<string, unknown>), id });
  }
  if (dropped > 0) {
    issues.push({ kind: "bad-record", detail: `Skipped ${dropped} record(s) in "${collection}" with no usable id.` });
  }
  return { records, issues };
}

function mergeRestoredSettings(parsed: unknown): AppSettings {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaultSettings;
  return { ...defaultSettings, ...(parsed as Partial<AppSettings>) };
}

export function previewSnapshot(snapshot: BackupSnapshot, issues: RestorePlanIssue[]): RestorePreview {
  return {
    formatVersion: snapshot.formatVersion,
    exportedAt: snapshot.exportedAt,
    totalRecords: snapshot.totalRecords,
    counts: snapshot.counts,
    hasSettings: true,
    issues,
  };
}

/** Writes a parsed snapshot back into the store.
 *
 *  Never deletes. A restore that could remove records would make "try
 *  restoring" a dangerous thing to do, and the one moment you reach for a
 *  backup is the moment you can least afford a second mistake. Cleaning up
 *  records the backup does not contain stays a manual, per-record decision. */
export async function restoreSnapshot(
  snapshot: BackupSnapshot,
  options: { mode: RestoreMode; restoreSettings: boolean; issues?: RestorePlanIssue[] },
): Promise<RestoreReport> {
  const written: Record<string, number> = {};
  const skipped: Record<string, number> = {};
  let totalWritten = 0;
  let totalSkipped = 0;

  for (const collection of collectionNames) {
    const incoming = (snapshot.data[collection] ?? []) as RestorableRecord[];
    if (incoming.length === 0) continue;

    let toWrite = incoming;
    if (options.mode === "fill-gaps") {
      const existing = new Set((await listRecords(collection)).map((record) => record.id));
      toWrite = incoming.filter((record) => !existing.has(record.id));
      const skippedHere = incoming.length - toWrite.length;
      if (skippedHere > 0) {
        skipped[collection] = skippedHere;
        totalSkipped += skippedHere;
      }
    }
    if (toWrite.length === 0) continue;

    await restoreRecords(collection as CollectionName, toWrite);
    written[collection] = toWrite.length;
    totalWritten += toWrite.length;
  }

  if (options.restoreSettings) {
    await saveSettings(snapshot.settings);
  }

  return {
    written,
    skipped,
    totalWritten,
    totalSkipped,
    settingsRestored: options.restoreSettings,
    issues: options.issues ?? [],
  };
}
