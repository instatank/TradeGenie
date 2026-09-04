import { createHash } from "crypto";
import { storageStatus } from "@/lib/store";
import type { BackupSnapshot } from "@/lib/backup";

// The offsite copy: a nightly commit of the whole journal into a SEPARATE,
// PRIVATE GitHub repository.
//
// Why GitHub, having measured the thing first: this journal is single-digit
// megabytes of JSON and will stay that way for years (~1KB per trade, ~264B per
// exchange fill). At that size every "real" backup product is solving a problem
// this app does not have, and the things that actually matter are: it costs
// nothing, it is somewhere else entirely from Firestore and Vercel, it keeps
// every past version without any retention policy to maintain, and the owner
// can recover it from a browser — which is the only interface they have. Git
// history gives all four for free. A commit per day of a file this size is
// noise on any storage measure.
//
// "Off until configured" — the same rule as the AI path, the SignalDesk bridge
// and the site password gate. With no BACKUP_GITHUB_TOKEN / BACKUP_GITHUB_REPO
// there is no network call at all, and not one byte of the journal leaves the
// app. Turning it on is an explicit act by the owner, because this is their
// trading data going to a third party and that is not a decision code should
// make quietly.

export type BackupDestination = {
  owner: string;
  repo: string;
  branch: string | null;
  token: string;
};

/** The file the whole journal lands in. One fixed path, overwritten each run:
 *  git history IS the archive, so dated filenames would only pile up in the
 *  tree while adding nothing you cannot already get from the file's history. */
export const BACKUP_PATH = "tradegenie-backup.json";
/** A ~1KB sidecar. Exists so the nightly run can answer "how big was last
 *  night's backup, and has anything changed since?" without downloading a
 *  multi-megabyte file every time — and so the settings panel can show the
 *  last backup's state for the cost of one small request. */
export const STATUS_PATH = "backup-status.json";
/** Recovery instructions, written INTO the backup repo. If this app is gone,
 *  the person holding the backup is the least equipped to work out what to do
 *  with it — so the instructions live next to the data, not in the codebase
 *  that may no longer exist. Identical content re-commits to the same git blob,
 *  so rewriting it every run costs nothing. */
export const RECOVERY_PATH = "HOW-TO-RESTORE.md";

const API = "https://api.github.com";
const SCREENSHOT_DIR = "screenshots";
/** Screenshots are uploaded a bounded number at a time so a first run against a
 *  long backlog cannot run the function out of time and fail the whole backup.
 *  Whatever is left is picked up by the next run. */
const MAX_SCREENSHOTS_PER_RUN = 25;

export type BackupStatusFile = {
  lastBackupAt: string;
  totalRecords: number;
  counts: Record<string, number>;
  /** Hash of the journal itself (data + settings), deliberately NOT of the
   *  whole file: exportedAt changes every run, so hashing the file would make
   *  every night look like a change and commit an identical journal forever. */
  contentHash: string;
  screenshotsStored: number;
  appCommit: string | null;
};

export type BackupOutcome =
  | { status: "off"; detail: string }
  | { status: "blocked"; detail: string }
  | { status: "unchanged"; detail: string; lastBackupAt: string | null }
  | { status: "failed"; detail: string }
  | {
      status: "ok";
      detail: string;
      commitUrl: string;
      commitSha: string;
      totalRecords: number;
      screenshotsUploaded: number;
      bytes: number;
    };

export function backupDestinationFromEnv(): BackupDestination | null {
  const token = process.env.BACKUP_GITHUB_TOKEN?.trim();
  const repo = process.env.BACKUP_GITHUB_REPO?.trim();
  if (!token || !repo) return null;
  const [owner, name] = repo.split("/");
  if (!owner || !name) return null;
  return { owner, repo: name, branch: process.env.BACKUP_GITHUB_BRANCH?.trim() || null, token };
}

export function backupConfigured() {
  return backupDestinationFromEnv() !== null;
}

export function journalHash(snapshot: BackupSnapshot) {
  return createHash("sha256")
    .update(JSON.stringify({ data: snapshot.data, settings: snapshot.settings }))
    .digest("hex");
}

/** Git's own object id for a blob, computed locally. Lets the uploader ask
 *  "is this exact file already in the repo?" by comparing against the tree
 *  listing — no download, and exact rather than a heuristic. */
export function gitBlobSha(content: Buffer) {
  return createHash("sha1")
    .update(Buffer.concat([Buffer.from(`blob ${content.length}\0`), content]))
    .digest("hex");
}

type ScreenshotUpload = { path: string; bytes: Buffer };

export type BackupInputs = {
  snapshot: BackupSnapshot;
  /** Called only for screenshots not already in the repo, so a run that has
   *  nothing new never touches Firebase Storage at all. */
  loadScreenshots?: (ids: string[]) => Promise<ScreenshotUpload[]>;
  /** Screenshot id -> the path it should live at in the backup repo. */
  screenshotTargets?: Map<string, string>;
  /** Skip the shrink guard. Only ever set from the owner pressing "Back up
   *  now" after being told why the automatic run refused. */
  force?: boolean;
  /** Injected in tests so the real client code runs against a fake API. */
  fetchImpl?: typeof fetch;
};

export async function pushBackup(inputs: BackupInputs): Promise<BackupOutcome> {
  const destination = backupDestinationFromEnv();
  if (!destination) {
    return { status: "off", detail: "Offsite backup is off. Set BACKUP_GITHUB_REPO and BACKUP_GITHUB_TOKEN to turn it on." };
  }

  // Guard 1: never let an app that is not reading the real database write over
  // a good backup. A misconfigured deploy falls back to an empty local store,
  // and a faithful nightly backup of that empty store is precisely how a
  // backup system destroys the thing it exists to protect.
  const storage = storageStatus();
  if (!storage.durable) {
    return {
      status: "blocked",
      detail: `Refusing to back up: storage is "${storage.mode}", not the durable database. Backing up an app that cannot see the real data would overwrite a good backup with an empty one.`,
    };
  }

  const api = githubApi(destination, inputs.fetchImpl ?? fetch);

  try {
    // Guard 2: the leak guard. A backup of a whole trading journal in a public
    // repo is the worst outcome this feature could produce — worse than having
    // no backup — so the repo's visibility is checked on every run, not once at
    // setup. A repo can be flipped to public later by accident.
    const repoInfo = await api.getRepo();
    if (repoInfo.private !== true) {
      return {
        status: "blocked",
        detail: `Refusing to back up: ${destination.owner}/${destination.repo} is a PUBLIC repository. Your whole journal would be readable by anyone. Make it private, then run the backup again.`,
      };
    }
    const branch = destination.branch ?? repoInfo.default_branch ?? "main";

    const previous = await api.readStatus(branch);
    const hash = journalHash(inputs.snapshot);

    // Guard 3: the shrink guard. If the journal has suddenly lost most of its
    // records, the likeliest explanations are a bug, a bad restore or an
    // attack — none of which should be quietly committed over the last good
    // copy. Say so and leave yesterday's backup as the newest one.
    if (!inputs.force && previous) {
      const blocked = shrinkGuard(previous.totalRecords, inputs.snapshot.totalRecords);
      if (blocked) return { status: "blocked", detail: blocked };
    }

    const backupBytes = Buffer.from(JSON.stringify(inputs.snapshot, null, 2), "utf8");

    // Nothing to say: the journal is byte-for-byte what was backed up last
    // time. Committing anyway would fill the history with identical snapshots
    // and make "when did this actually change?" unanswerable.
    const existingTree = await api.readTree(branch);
    const missingScreenshots = pendingScreenshots(inputs.screenshotTargets, existingTree);
    if (previous?.contentHash === hash && missingScreenshots.length === 0) {
      return {
        status: "unchanged",
        detail: "Nothing has changed since the last backup, so no new copy was written.",
        lastBackupAt: previous.lastBackupAt,
      };
    }

    const screenshots =
      missingScreenshots.length > 0 && inputs.loadScreenshots
        ? await inputs.loadScreenshots(missingScreenshots.slice(0, MAX_SCREENSHOTS_PER_RUN))
        : [];

    const status: BackupStatusFile = {
      lastBackupAt: inputs.snapshot.exportedAt,
      totalRecords: inputs.snapshot.totalRecords,
      counts: inputs.snapshot.counts,
      contentHash: hash,
      screenshotsStored: (existingTree?.screenshotPaths.size ?? 0) + screenshots.length,
      appCommit: inputs.snapshot.appCommit,
    };

    const files: { path: string; bytes: Buffer }[] = [
      { path: BACKUP_PATH, bytes: backupBytes },
      { path: STATUS_PATH, bytes: Buffer.from(JSON.stringify(status, null, 2), "utf8") },
      { path: RECOVERY_PATH, bytes: Buffer.from(recoveryDoc(destination), "utf8") },
      ...screenshots,
    ];

    const commit = await api.commitFiles({
      branch,
      files,
      message: commitMessage(inputs.snapshot, screenshots.length),
    });

    return {
      status: "ok",
      detail: `Backed up ${inputs.snapshot.totalRecords} records${screenshots.length ? ` and ${screenshots.length} screenshot(s)` : ""}.`,
      commitUrl: `https://github.com/${destination.owner}/${destination.repo}/commit/${commit}`,
      commitSha: commit,
      totalRecords: inputs.snapshot.totalRecords,
      screenshotsUploaded: screenshots.length,
      bytes: backupBytes.length,
    };
  } catch (error) {
    // A failed backup must never take the app down with it — same rule as the
    // market-context snapshot and the AI path. It reports and stops.
    return { status: "failed", detail: describeError(error) };
  }
}

export type DestinationCheck =
  | { status: "off"; detail: string }
  | { status: "problem"; detail: string }
  | {
      status: "ready";
      detail: string;
      repoUrl: string;
      branch: string;
      lastBackupAt: string | null;
      lastBackupRecords: number | null;
    };

/** Answers "is this set up correctly?" WITHOUT sending any journal data.
 *
 *  This exists because the last mile of this feature cannot be verified from
 *  the machine it was written on — only against the owner's own repository and
 *  token. So rather than asking them to trust that it works, they get a button
 *  that finds out. It also means the repo's privacy can be confirmed before a
 *  single byte of the journal is ever sent anywhere.
 *
 *  Modelled on the existing "Test AI connection" on /settings — same problem,
 *  same answer: when a claim can only be checked with real credentials, ship
 *  the check. */
export async function checkDestination(fetchImpl: typeof fetch = fetch): Promise<DestinationCheck> {
  const destination = backupDestinationFromEnv();
  if (!destination) {
    return { status: "off", detail: "Not set up yet — no BACKUP_GITHUB_REPO / BACKUP_GITHUB_TOKEN." };
  }
  const api = githubApi(destination, fetchImpl);
  try {
    const repo = await api.getRepo();
    if (repo.private !== true) {
      return {
        status: "problem",
        detail: `${destination.owner}/${destination.repo} is PUBLIC. Backups are refused while it is, because your whole journal would be readable by anyone. Make it private in the repository's settings.`,
      };
    }
    const branch = destination.branch ?? repo.default_branch ?? "main";
    const status = await api.readStatus(branch);
    return {
      status: "ready",
      detail: status
        ? `Connected. Last backup ${status.lastBackupAt.slice(0, 16).replace("T", " ")} with ${status.totalRecords} records.`
        : "Connected to a private repository. No backup has been written to it yet.",
      repoUrl: `https://github.com/${destination.owner}/${destination.repo}`,
      branch,
      lastBackupAt: status?.lastBackupAt ?? null,
      lastBackupRecords: status?.totalRecords ?? null,
    };
  } catch (error) {
    return { status: "problem", detail: describeError(error) };
  }
}

/** Exported so the settings panel can show the last backup without re-running
 *  one, and so the guard logic above has a single tested definition. */
export function shrinkGuard(previousRecords: number, nextRecords: number): string | null {
  if (previousRecords <= 0) return null;
  if (nextRecords === 0) {
    return `Refusing to back up: the journal now reports 0 records but the last backup held ${previousRecords}. That looks like data loss, not a backup. Yesterday's backup has been left untouched.`;
  }
  if (nextRecords < previousRecords / 2) {
    return `Refusing to back up: the journal has ${nextRecords} records but the last backup held ${previousRecords} — more than half are gone. Yesterday's backup has been left untouched. If you deleted them on purpose, use "Back up now" on the settings page to push it through.`;
  }
  return null;
}

function pendingScreenshots(
  targets: Map<string, string> | undefined,
  tree: { screenshotPaths: Set<string>; complete: boolean } | null,
): string[] {
  if (!targets || targets.size === 0) return [];
  // With an incomplete listing we cannot tell what is already stored, and
  // guessing "nothing" would re-upload every image every night.
  if (tree && !tree.complete) return [];
  const present = tree?.screenshotPaths ?? new Set<string>();
  return Array.from(targets.entries())
    .filter(([, path]) => !present.has(path))
    .map(([id]) => id);
}

export function screenshotBackupPath(id: string, filePath: string) {
  const match = /\.([a-zA-Z0-9]{1,5})$/.exec(filePath);
  const extension = match ? match[1].toLowerCase() : "bin";
  return `${SCREENSHOT_DIR}/${id}.${extension}`;
}

function commitMessage(snapshot: BackupSnapshot, screenshots: number) {
  const parts = [`Backup ${snapshot.exportedAt.slice(0, 16).replace("T", " ")} — ${snapshot.totalRecords} records`];
  if (screenshots > 0) parts.push(`+${screenshots} screenshot(s)`);
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// GitHub, at the level of git objects rather than files
// ---------------------------------------------------------------------------
//
// The Contents API would need one request per file and would download the whole
// backup just to learn the sha it must pass back. The Git Data API instead
// builds one commit containing every file — the journal, the status sidecar,
// the recovery notes and any new screenshots — so a run either lands completely
// or not at all, and nothing is ever downloaded.

function githubApi(destination: BackupDestination, fetchImpl: typeof fetch) {
  const base = `${API}/repos/${destination.owner}/${destination.repo}`;

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetchImpl(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${destination.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new GithubError(response.status, path, body.slice(0, 400));
    }
    return (await response.json()) as T;
  }

  async function callOrNull<T>(path: string): Promise<T | null> {
    try {
      return await call<T>(path);
    } catch (error) {
      // A repo with no commits yet, or a first run before any backup exists.
      if (error instanceof GithubError && error.status === 404) return null;
      throw error;
    }
  }

  return {
    async getRepo() {
      return call<{ private: boolean; default_branch: string }>("");
    },

    async readStatus(branch: string): Promise<BackupStatusFile | null> {
      const file = await callOrNull<{ content?: string; encoding?: string }>(
        `/contents/${STATUS_PATH}?ref=${encodeURIComponent(branch)}`,
      );
      if (!file?.content) return null;
      try {
        return JSON.parse(Buffer.from(file.content, "base64").toString("utf8")) as BackupStatusFile;
      } catch {
        // A corrupt sidecar must not stop tonight's backup. Losing the shrink
        // guard for one run is a far smaller problem than not backing up.
        return null;
      }
    },

    async readTree(branch: string) {
      const ref = await callOrNull<{ object: { sha: string } }>(`/git/ref/heads/${encodeURIComponent(branch)}`);
      if (!ref) return null;
      const commit = await call<{ tree: { sha: string } }>(`/git/commits/${ref.object.sha}`);
      const tree = await call<{ tree: { path: string; sha: string }[]; truncated?: boolean }>(
        `/git/trees/${commit.tree.sha}?recursive=1`,
      );
      const screenshotPaths = new Set(
        (tree.tree ?? []).filter((entry) => entry.path.startsWith(`${SCREENSHOT_DIR}/`)).map((entry) => entry.path),
      );
      // A truncated listing means "this is not all of them", and treating a
      // partial list as complete would re-upload screenshots that are already
      // there on every single run. Unknown is reported as such; the JSON
      // backup, which is what actually matters, proceeds either way.
      return {
        commitSha: ref.object.sha,
        treeSha: commit.tree.sha,
        screenshotPaths,
        complete: tree.truncated !== true,
      };
    },

    async commitFiles({ branch, files, message }: { branch: string; files: { path: string; bytes: Buffer }[]; message: string }) {
      const head = await callOrNull<{ object: { sha: string } }>(`/git/ref/heads/${encodeURIComponent(branch)}`);
      const parentSha = head?.object.sha ?? null;
      const baseTree = parentSha
        ? (await call<{ tree: { sha: string } }>(`/git/commits/${parentSha}`)).tree.sha
        : null;

      const blobs = await Promise.all(
        files.map(async (file) => {
          const blob = await call<{ sha: string }>("/git/blobs", {
            method: "POST",
            body: JSON.stringify({ content: file.bytes.toString("base64"), encoding: "base64" }),
          });
          return { path: file.path, mode: "100644" as const, type: "blob" as const, sha: blob.sha };
        }),
      );

      const tree = await call<{ sha: string }>("/git/trees", {
        method: "POST",
        body: JSON.stringify({ ...(baseTree ? { base_tree: baseTree } : {}), tree: blobs }),
      });

      const commit = await call<{ sha: string }>("/git/commits", {
        method: "POST",
        body: JSON.stringify({ message, tree: tree.sha, parents: parentSha ? [parentSha] : [] }),
      });

      // An empty repository has no branch to move, so the ref is created rather
      // than updated. Without this the very first backup into a freshly made
      // repo fails, which is the one run the owner is watching.
      if (parentSha) {
        await call(`/git/refs/heads/${encodeURIComponent(branch)}`, {
          method: "PATCH",
          body: JSON.stringify({ sha: commit.sha }),
        });
      } else {
        await call("/git/refs", {
          method: "POST",
          body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
        });
      }
      return commit.sha;
    },
  };
}

class GithubError extends Error {
  constructor(readonly status: number, readonly path: string, readonly body: string) {
    super(`GitHub ${status} on ${path}${body ? `: ${body}` : ""}`);
  }
}

function describeError(error: unknown): string {
  if (error instanceof GithubError) {
    // Plain English for the two failures the owner can actually fix.
    if (error.status === 401) return "GitHub rejected the token (401). Create a new token and update BACKUP_GITHUB_TOKEN in Vercel.";
    if (error.status === 403) return "GitHub refused the request (403). The token is probably missing Contents: Read and write permission on the backup repository.";
    if (error.status === 404) return "GitHub could not find that repository (404). Check BACKUP_GITHUB_REPO, and that the token has access to it.";
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function recoveryDoc(destination: BackupDestination) {
  return `# How to get this journal back

This repository holds automatic backups of TradeGenie, a personal trading
journal. Everything is in \`${BACKUP_PATH}\` — one JSON file containing every
trade, note, journal entry, lesson, asset thread and setting.

**This file is private data. Keep this repository private.**

## If the app is still running

1. Open the app and go to **Settings → Data & backup**.
2. Under **Restore from a backup**, choose a \`${BACKUP_PATH}\` file
   downloaded from this repository and press Restore.
3. The default restore only adds records that are missing — it will not
   overwrite anything you have written since the backup was taken.

## If you need an older version

Every backup is a commit here, so the full history is kept:

  https://github.com/${destination.owner}/${destination.repo}/commits/HEAD/${BACKUP_PATH}

Open any commit, click the file, then **Download raw file**, and restore that.

## If the app is gone entirely

The data does not depend on the app. \`${BACKUP_PATH}\` is ordinary JSON:

\`\`\`
{
  "exportedAt": "...",
  "counts":    { "trades": 128, ... },
  "settings":  { ... },
  "data": {
    "trades":   [ ... ],
    "freeNotes":[ ... ],
    ...
  }
}
\`\`\`

Each entry under \`data\` is a list of records with an \`id\` and plain fields.
Any spreadsheet, script or new app can read it — nothing here is in a
proprietary format, and no part of it needs TradeGenie to be readable.

\`${STATUS_PATH}\` records when the last backup ran and how many records it
held, so you can tell at a glance whether backups are still happening.

Screenshots attached to trades, if any, are the image files under
\`screenshots/\`, named by the screenshot id recorded in the JSON.
`;
}
