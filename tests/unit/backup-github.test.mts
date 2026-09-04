// The offsite backup, exercised end to end against a stand-in GitHub.
//
// The honest limitation, stated up front: this machine cannot reach GitHub's
// git-data endpoints (the session proxy only exposes the code repository), so
// what runs below is the REAL client against a FAKE server. That catches every
// bug in our own code — request sequencing, base64, the guards, the empty-repo
// path, what actually lands in the commit — and it cannot catch a mistaken
// belief about GitHub's contract. That last mile is covered instead by the
// "Check connection" button on /settings, which makes one real request against
// the owner's own repository and reports what happened.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

delete process.env.FIREBASE_PROJECT_ID;
delete process.env.FIREBASE_CLIENT_EMAIL;
delete process.env.FIREBASE_PRIVATE_KEY;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

const {
  BACKUP_PATH,
  RECOVERY_PATH,
  STATUS_PATH,
  checkDestination,
  gitBlobSha,
  journalHash,
  pushBackup,
  screenshotBackupPath,
  shrinkGuard,
} = await import("@/lib/backup-github");
type BackupSnapshot = import("@/lib/backup").BackupSnapshot;

const ENV_KEYS = ["BACKUP_GITHUB_TOKEN", "BACKUP_GITHUB_REPO", "BACKUP_GITHUB_BRANCH"] as const;
after(() => ENV_KEYS.forEach((key) => delete process.env[key]));

function configure({ branch }: { branch?: string } = {}) {
  process.env.BACKUP_GITHUB_TOKEN = "test-token";
  process.env.BACKUP_GITHUB_REPO = "instatank/tradegenie-backups";
  if (branch) process.env.BACKUP_GITHUB_BRANCH = branch;
  else delete process.env.BACKUP_GITHUB_BRANCH;
}

function snapshotOf(records: number, journalMarker = "a"): BackupSnapshot {
  return {
    formatVersion: 1,
    exportedAt: "2026-09-04T02:30:00.000Z",
    appCommit: "abc123",
    storageMode: "firestore",
    durable: true,
    counts: { trades: records },
    totalRecords: records,
    settings: { marker: journalMarker } as never,
    data: { trades: Array.from({ length: records }, (_, index) => ({ id: `t${index}`, marker: journalMarker })) },
  };
}

// ---------------------------------------------------------------------------
// A stand-in GitHub that behaves like the real git-data API: content-addressed
// blobs, trees layered over a base_tree, commits with parents, and a movable
// branch ref. Faithful enough that a client bug shows up as wrong repo content
// rather than as a passing assertion.
// ---------------------------------------------------------------------------
type FakeRepo = {
  private: boolean;
  default_branch: string;
  blobs: Map<string, Buffer>;
  trees: Map<string, { path: string; sha: string }[]>;
  commits: Map<string, { tree: string; parents: string[]; message: string }>;
  refs: Map<string, string>;
  truncateTrees?: boolean;
};

function newRepo(overrides: Partial<FakeRepo> = {}): FakeRepo {
  return {
    private: true,
    default_branch: "main",
    blobs: new Map(),
    trees: new Map(),
    commits: new Map(),
    refs: new Map(),
    ...overrides,
  };
}

function fakeGithub(repo: FakeRepo) {
  const calls: string[] = [];
  let counter = 0;
  const nextSha = (prefix: string) => `${prefix}${(counter += 1).toString(16).padStart(38, "0")}`;

  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    const method = init?.method ?? "GET";
    const path = href.replace("https://api.github.com/repos/instatank/tradegenie-backups", "");
    calls.push(`${method} ${path}`);

    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      "Bearer test-token",
      "every request must carry the token",
    );

    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const notFound = () => json({ message: "Not Found" }, 404);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, never>) : {};

    if (path === "" && method === "GET") {
      return json({ private: repo.private, default_branch: repo.default_branch });
    }

    if (path.startsWith("/contents/") && method === "GET") {
      const [, file] = /^\/contents\/([^?]+)/.exec(path) ?? [];
      const branch = decodeURIComponent(new URL(href).searchParams.get("ref") ?? repo.default_branch);
      const head = repo.refs.get(branch);
      if (!head) return notFound();
      const tree = repo.trees.get(repo.commits.get(head)!.tree)!;
      const entry = tree.find((item) => item.path === decodeURIComponent(file));
      if (!entry) return notFound();
      return json({ content: repo.blobs.get(entry.sha)!.toString("base64"), encoding: "base64" });
    }

    if (path.startsWith("/git/ref/heads/") && method === "GET") {
      const branch = decodeURIComponent(path.replace("/git/ref/heads/", ""));
      const sha = repo.refs.get(branch);
      return sha ? json({ object: { sha } }) : notFound();
    }

    if (path.startsWith("/git/commits/") && method === "GET") {
      const commit = repo.commits.get(path.replace("/git/commits/", ""));
      return commit ? json({ tree: { sha: commit.tree } }) : notFound();
    }

    if (path.startsWith("/git/trees/") && method === "GET") {
      const sha = path.replace("/git/trees/", "").split("?")[0];
      const tree = repo.trees.get(sha);
      if (!tree) return notFound();
      return json({ tree: tree.map((e) => ({ ...e, mode: "100644", type: "blob" })), truncated: repo.truncateTrees === true });
    }

    if (path === "/git/blobs" && method === "POST") {
      const bytes = Buffer.from(String(body.content), String(body.encoding) as BufferEncoding);
      // Content-addressed, like the real thing: the same bytes are one object.
      const sha = gitBlobSha(bytes);
      repo.blobs.set(sha, bytes);
      return json({ sha });
    }

    if (path === "/git/trees" && method === "POST") {
      const base = body.base_tree ? [...(repo.trees.get(String(body.base_tree)) ?? [])] : [];
      const merged = new Map(base.map((entry) => [entry.path, entry]));
      for (const entry of body.tree as unknown as { path: string; sha: string }[]) {
        merged.set(entry.path, { path: entry.path, sha: entry.sha });
      }
      const sha = nextSha("t");
      repo.trees.set(sha, Array.from(merged.values()));
      return json({ sha });
    }

    if (path === "/git/commits" && method === "POST") {
      const sha = nextSha("c");
      repo.commits.set(sha, {
        tree: String(body.tree),
        parents: (body.parents as unknown as string[]) ?? [],
        message: String(body.message),
      });
      return json({ sha });
    }

    if (path.startsWith("/git/refs/heads/") && method === "PATCH") {
      const branch = decodeURIComponent(path.replace("/git/refs/heads/", ""));
      if (!repo.refs.has(branch)) return notFound();
      repo.refs.set(branch, String(body.sha));
      return json({ ok: true });
    }

    if (path === "/git/refs" && method === "POST") {
      repo.refs.set(String(body.ref).replace("refs/heads/", ""), String(body.sha));
      return json({ ok: true });
    }

    return json({ message: `unhandled ${method} ${path}` }, 500);
  }) as unknown as typeof fetch;

  const fileAt = (branch: string, path: string) => {
    const head = repo.refs.get(branch);
    if (!head) return null;
    const tree = repo.trees.get(repo.commits.get(head)!.tree)!;
    const entry = tree.find((item) => item.path === path);
    return entry ? repo.blobs.get(entry.sha)!.toString("utf8") : null;
  };

  const pathsAt = (branch: string) => {
    const head = repo.refs.get(branch);
    if (!head) return [];
    return repo.trees.get(repo.commits.get(head)!.tree)!.map((entry) => entry.path).sort();
  };

  return { fetchImpl, calls, fileAt, pathsAt };
}

// Storage must look durable, or guard 1 refuses before anything else runs.
function durable() {
  process.env.FIREBASE_PROJECT_ID = "p";
  process.env.FIREBASE_CLIENT_EMAIL = "e@example.com";
  process.env.FIREBASE_PRIVATE_KEY = "k";
}
function notDurable() {
  delete process.env.FIREBASE_PROJECT_ID;
  delete process.env.FIREBASE_CLIENT_EMAIL;
  delete process.env.FIREBASE_PRIVATE_KEY;
}

beforeEach(() => {
  configure();
  durable();
});

after(notDurable);

describe("off until configured", () => {
  it("makes no network call at all when there is no repo or token", async () => {
    ENV_KEYS.forEach((key) => delete process.env[key]);
    let called = false;
    const outcome = await pushBackup({
      snapshot: snapshotOf(3),
      fetchImpl: (async () => {
        called = true;
        return new Response("{}");
      }) as unknown as typeof fetch,
    });
    assert.equal(outcome.status, "off");
    assert.equal(called, false, "an unconfigured backup must not touch the network");
  });
});

describe("the guards", () => {
  it("refuses to write when storage is not the durable database", async () => {
    notDurable();
    const github = fakeGithub(newRepo());
    const outcome = await pushBackup({ snapshot: snapshotOf(50), fetchImpl: github.fetchImpl });
    assert.equal(outcome.status, "blocked");
    assert.match(outcome.detail, /not the durable database/);
    assert.deepEqual(github.calls, [], "a blocked backup must not reach GitHub");
    durable();
  });

  it("refuses a PUBLIC repository, because that is a leak and not a backup", async () => {
    const github = fakeGithub(newRepo({ private: false }));
    const outcome = await pushBackup({ snapshot: snapshotOf(50), fetchImpl: github.fetchImpl });
    assert.equal(outcome.status, "blocked");
    assert.match(outcome.detail, /PUBLIC/);
    assert.deepEqual(github.calls, ["GET "], "it must stop at the visibility check, before sending any data");
  });

  it("re-checks visibility on every run, not just at setup", async () => {
    const repo = newRepo();
    const github = fakeGithub(repo);
    assert.equal((await pushBackup({ snapshot: snapshotOf(50), fetchImpl: github.fetchImpl })).status, "ok");
    repo.private = false; // someone flips it public later
    const second = await pushBackup({ snapshot: snapshotOf(60, "b"), fetchImpl: github.fetchImpl });
    assert.equal(second.status, "blocked");
  });

  it("refuses a snapshot that has lost most of its records", async () => {
    const repo = newRepo();
    const github = fakeGithub(repo);
    await pushBackup({ snapshot: snapshotOf(100), fetchImpl: github.fetchImpl });
    const before = github.fileAt("main", BACKUP_PATH);

    const outcome = await pushBackup({ snapshot: snapshotOf(9, "wiped"), fetchImpl: github.fetchImpl });
    assert.equal(outcome.status, "blocked");
    assert.match(outcome.detail, /more than half are gone/);
    assert.equal(github.fileAt("main", BACKUP_PATH), before, "the good backup must be left exactly as it was");
  });

  it("lets the owner force a deliberate big deletion through", async () => {
    const github = fakeGithub(newRepo());
    await pushBackup({ snapshot: snapshotOf(100), fetchImpl: github.fetchImpl });
    const outcome = await pushBackup({ snapshot: snapshotOf(9, "wiped"), force: true, fetchImpl: github.fetchImpl });
    assert.equal(outcome.status, "ok");
  });

  it("treats a drop to zero as data loss even before the half threshold applies", () => {
    assert.match(String(shrinkGuard(1, 0)), /looks like data loss/);
    assert.equal(shrinkGuard(0, 0), null, "a first-ever backup of an empty journal is fine");
    assert.equal(shrinkGuard(100, 60), null, "ordinary variation is not blocked");
  });
});

describe("what actually lands in the repo", () => {
  it("writes the journal, the status sidecar and the recovery notes in one commit", async () => {
    const repo = newRepo();
    const github = fakeGithub(repo);
    const snapshot = snapshotOf(12);
    const outcome = await pushBackup({ snapshot, fetchImpl: github.fetchImpl });

    assert.equal(outcome.status, "ok");
    assert.deepEqual(github.pathsAt("main"), [BACKUP_PATH, RECOVERY_PATH, STATUS_PATH].sort());
    assert.equal(repo.commits.size, 1, "one commit, not one per file");

    const restored = JSON.parse(github.fileAt("main", BACKUP_PATH)!);
    assert.deepEqual(restored.data, snapshot.data, "the committed file must be the journal, unaltered");

    const status = JSON.parse(github.fileAt("main", STATUS_PATH)!);
    assert.equal(status.totalRecords, 12);
    assert.equal(status.contentHash, journalHash(snapshot));

    assert.match(github.fileAt("main", RECOVERY_PATH)!, /How to get this journal back/);
  });

  it("creates the branch on a repository that has no commits yet", async () => {
    const repo = newRepo(); // no refs at all
    const github = fakeGithub(repo);
    const outcome = await pushBackup({ snapshot: snapshotOf(4), fetchImpl: github.fetchImpl });
    assert.equal(outcome.status, "ok", "the very first backup into a fresh empty repo must work");
    assert.equal(repo.refs.get("main"), (outcome as { commitSha: string }).commitSha);
    assert.deepEqual(repo.commits.get(repo.refs.get("main")!)!.parents, []);
  });

  it("chains each backup onto the last, so history is browsable", async () => {
    const repo = newRepo();
    const github = fakeGithub(repo);
    const first = await pushBackup({ snapshot: snapshotOf(4), fetchImpl: github.fetchImpl });
    const second = await pushBackup({ snapshot: snapshotOf(5, "later"), fetchImpl: github.fetchImpl });
    assert.equal(second.status, "ok");
    const head = repo.commits.get((second as { commitSha: string }).commitSha)!;
    assert.deepEqual(head.parents, [(first as { commitSha: string }).commitSha]);
  });

  it("does not commit when nothing in the journal has changed", async () => {
    const github = fakeGithub(newRepo());
    await pushBackup({ snapshot: snapshotOf(7), fetchImpl: github.fetchImpl });
    // Same journal, later run: exportedAt differs, the journal does not.
    const later = { ...snapshotOf(7), exportedAt: "2026-09-05T02:30:00.000Z" };
    const outcome = await pushBackup({ snapshot: later, fetchImpl: github.fetchImpl });
    assert.equal(outcome.status, "unchanged");
    assert.equal(outcome.lastBackupAt, "2026-09-04T02:30:00.000Z");
  });

  it("does commit when the journal changed but the record count did not", async () => {
    // Editing a note changes nothing about the counts. A backup keyed on
    // counts would silently stop capturing edits.
    const github = fakeGithub(newRepo());
    await pushBackup({ snapshot: snapshotOf(7, "before"), fetchImpl: github.fetchImpl });
    const outcome = await pushBackup({ snapshot: snapshotOf(7, "after"), fetchImpl: github.fetchImpl });
    assert.equal(outcome.status, "ok");
    assert.match(github.fileAt("main", BACKUP_PATH)!, /"after"/);
  });

  it("honours an explicit branch override", async () => {
    configure({ branch: "snapshots" });
    const repo = newRepo({ default_branch: "main" });
    const github = fakeGithub(repo);
    assert.equal((await pushBackup({ snapshot: snapshotOf(2), fetchImpl: github.fetchImpl })).status, "ok");
    assert.ok(repo.refs.has("snapshots"));
    assert.ok(!repo.refs.has("main"));
  });
});

describe("screenshots", () => {
  const targets = new Map([
    ["s1", screenshotBackupPath("s1", "firebase://bucket/screenshots/trades/t1/1-chart.png")],
    ["s2", screenshotBackupPath("s2", "/uploads/t2-2-shot.jpg")],
  ]);

  it("uploads each image once and never again", async () => {
    const github = fakeGithub(newRepo());
    const loaded: string[][] = [];
    const loadScreenshots = async (ids: string[]) => {
      loaded.push(ids);
      return ids.map((id) => ({ path: targets.get(id)!, bytes: Buffer.from(`image-${id}`) }));
    };

    const first = await pushBackup({ snapshot: snapshotOf(3), screenshotTargets: targets, loadScreenshots, fetchImpl: github.fetchImpl });
    assert.equal((first as { screenshotsUploaded: number }).screenshotsUploaded, 2);
    assert.deepEqual(github.pathsAt("main"), [BACKUP_PATH, RECOVERY_PATH, STATUS_PATH, "screenshots/s1.png", "screenshots/s2.jpg"].sort());

    // Journal changed, images did not: the images must not be fetched again.
    const second = await pushBackup({ snapshot: snapshotOf(4, "b"), screenshotTargets: targets, loadScreenshots, fetchImpl: github.fetchImpl });
    assert.equal((second as { screenshotsUploaded: number }).screenshotsUploaded, 0);
    assert.deepEqual(loaded, [["s1", "s2"]], "storage must be read only for images not already backed up");
  });

  it("commits a new image even when the journal text is unchanged", async () => {
    const github = fakeGithub(newRepo());
    const load = async (ids: string[]) => ids.map((id) => ({ path: targets.get(id)!, bytes: Buffer.from(id) }));
    await pushBackup({ snapshot: snapshotOf(3), fetchImpl: github.fetchImpl });
    const outcome = await pushBackup({ snapshot: snapshotOf(3), screenshotTargets: targets, loadScreenshots: load, fetchImpl: github.fetchImpl });
    assert.equal(outcome.status, "ok", "an unchanged journal with a new screenshot is still a change");
  });

  it("skips image upload rather than re-uploading everything when the tree listing is incomplete", async () => {
    // Only meaningful once a tree exists: with no commits yet there is nothing
    // to have been truncated, and uploading everything is then correct.
    const repo = newRepo();
    const github = fakeGithub(repo);
    await pushBackup({ snapshot: snapshotOf(3), fetchImpl: github.fetchImpl });

    repo.truncateTrees = true;
    let loadedAny = false;
    await pushBackup({
      snapshot: snapshotOf(4, "b"),
      screenshotTargets: targets,
      loadScreenshots: async (ids) => {
        loadedAny = true;
        return ids.map((id) => ({ path: targets.get(id)!, bytes: Buffer.from(id) }));
      },
      fetchImpl: github.fetchImpl,
    });
    assert.equal(loadedAny, false, "an incomplete listing must not be read as 'nothing is stored'");
  });

  it("keeps the file extension so the image is still openable", () => {
    assert.equal(screenshotBackupPath("abc", "firebase://b/screenshots/trades/t/1-chart.PNG"), "screenshots/abc.png");
    assert.equal(screenshotBackupPath("abc", "/uploads/no-extension"), "screenshots/abc.bin");
  });
});

describe("failures are reported, never thrown at the app", () => {
  it("turns a rejected token into something the owner can act on", async () => {
    const outcome = await pushBackup({
      snapshot: snapshotOf(3),
      fetchImpl: (async () => new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 })) as unknown as typeof fetch,
    });
    assert.equal(outcome.status, "failed");
    assert.match(outcome.detail, /rejected the token/);
  });

  it("explains a missing permission rather than showing a status code", async () => {
    const outcome = await pushBackup({
      snapshot: snapshotOf(3),
      fetchImpl: (async () => new Response("{}", { status: 403 })) as unknown as typeof fetch,
    });
    assert.match((outcome as { detail: string }).detail, /Contents: Read and write/);
  });

  it("survives the network being down", async () => {
    const outcome = await pushBackup({
      snapshot: snapshotOf(3),
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    });
    assert.equal(outcome.status, "failed");
    assert.match(outcome.detail, /ECONNREFUSED/);
  });
});

describe("the connection check sends no data", () => {
  it("confirms a private repo and reports the last backup", async () => {
    const github = fakeGithub(newRepo());
    await pushBackup({ snapshot: snapshotOf(11), fetchImpl: github.fetchImpl });
    const check = await checkDestination(github.fetchImpl);
    assert.equal(check.status, "ready");
    assert.match(check.detail, /11 records/);
  });

  it("names a public repo as the problem it is", async () => {
    const check = await checkDestination(fakeGithub(newRepo({ private: false })).fetchImpl);
    assert.equal(check.status, "problem");
    assert.match(check.detail, /PUBLIC/);
  });

  it("never writes anything", async () => {
    const repo = newRepo();
    const github = fakeGithub(repo);
    await checkDestination(github.fetchImpl);
    assert.equal(repo.commits.size, 0);
    assert.ok(!github.calls.some((call) => call.startsWith("POST") || call.startsWith("PATCH")));
  });
});
