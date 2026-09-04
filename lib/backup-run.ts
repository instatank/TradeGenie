import { buildSnapshot } from "@/lib/backup";
import { pushBackup, screenshotBackupPath, type BackupOutcome } from "@/lib/backup-github";
import { readScreenshotFile } from "@/lib/screenshot-storage";
import { listRecords } from "@/lib/store";

// One place that runs a backup, shared by the scheduled job and the "Back up
// now" button, for the same reason lib/backup.ts is one definition of what a
// backup contains: two callers that assemble a run separately will eventually
// assemble different runs, and the one that matters is the one nobody is
// watching.

export type BackupRun = { outcome: BackupOutcome; totalRecords: number };

export async function runBackup(options: { force?: boolean } = {}): Promise<BackupRun> {
  const snapshot = await buildSnapshot();

  // Screenshot IMAGE BYTES are the one part of the journal the JSON cannot
  // carry — the records in it hold only a path into Firebase Storage, which
  // shares its failure domain with the database this is backing up. So the
  // files travel too, addressed by screenshot id so a restored record still
  // points at something findable.
  const screenshots = await listRecords("screenshots");
  const screenshotTargets = new Map(
    screenshots.map((screenshot) => [screenshot.id, screenshotBackupPath(screenshot.id, screenshot.filePath)]),
  );

  const outcome = await pushBackup({
    snapshot,
    force: options.force,
    screenshotTargets,
    loadScreenshots: async (ids) => {
      const wanted = new Set(ids);
      const loaded: { path: string; bytes: Buffer }[] = [];
      for (const screenshot of screenshots) {
        if (!wanted.has(screenshot.id)) continue;
        try {
          const file = await readScreenshotFile(screenshot.filePath);
          loaded.push({ path: screenshotTargets.get(screenshot.id)!, bytes: file.bytes });
        } catch {
          // One unreadable image must not cost the whole backup. The journal
          // text is the part that cannot be recreated; a missing screenshot is
          // simply retried on the next run.
        }
      }
      return loaded;
    },
  });

  return { outcome, totalRecords: snapshot.totalRecords };
}
