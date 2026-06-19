import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Durability tests (Tier 5) exercise the REAL store, which is the data-safety
// contract: storageStatus() decides "durable vs ephemeral vs refuse", and the
// dehydrate/hydrate round-trip must preserve Date types through JSON.

const FIREBASE_ENV = ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY", "GOOGLE_APPLICATION_CREDENTIALS"];

describe("storageStatus / usesFirebase (the durability source of truth)", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of FIREBASE_ENV) { saved[key] = process.env[key]; delete process.env[key]; }
    vi.resetModules();
  });
  afterEach(() => {
    for (const key of FIREBASE_ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("reports 'local' (not durable) when no credentials are set", async () => {
    const { storageStatus, usesFirebase } = await import("@/lib/store");
    expect(storageStatus()).toEqual({ mode: "local", durable: false });
    expect(usesFirebase()).toBe(false);
  });

  it("reports durable 'firestore' when the full service account is present", async () => {
    process.env.FIREBASE_PROJECT_ID = "p";
    process.env.FIREBASE_CLIENT_EMAIL = "e@x.iam";
    process.env.FIREBASE_PRIVATE_KEY = "key";
    const { storageStatus, usesFirebase } = await import("@/lib/store");
    expect(storageStatus()).toMatchObject({ mode: "firestore", durable: true, source: "service-account" });
    expect(usesFirebase()).toBe(true);
  });

  it("reports application-default when only GOOGLE_APPLICATION_CREDENTIALS is set", async () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/path/to/adc.json";
    const { storageStatus } = await import("@/lib/store");
    expect(storageStatus()).toMatchObject({ mode: "firestore", durable: true, source: "application-default" });
  });

  it("refuses (invalid, not durable) on a PARTIAL service account — never a silent fallback", async () => {
    process.env.FIREBASE_PROJECT_ID = "p"; // missing CLIENT_EMAIL + PRIVATE_KEY
    const { storageStatus, usesFirebase } = await import("@/lib/store");
    const status = storageStatus();
    expect(status.mode).toBe("invalid");
    if (status.mode === "invalid") {
      expect(status.durable).toBe(false);
      expect(status.missing).toEqual(["FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"]);
    }
    // The fail-loud guarantee: callers can't accidentally proceed on a half config.
    expect(() => usesFirebase()).toThrow();
  });
});

describe("local store round-trip preserves Date types through JSON", () => {
  const saved: Record<string, string | undefined> = {};
  const originalCwd = process.cwd();
  let tempDir: string;

  beforeEach(() => {
    for (const key of FIREBASE_ENV) { saved[key] = process.env[key]; delete process.env[key]; }
    tempDir = path.join(tmpdir(), `tg-store-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    process.chdir(originalCwd); // ensure a clean base before we recompute the store path
    vi.resetModules();
  });
  afterEach(async () => {
    process.chdir(originalCwd);
    for (const key of FIREBASE_ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it("writes and reads back createdAt / tradeDateTime as Date instances", async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(tempDir, { recursive: true });
    process.chdir(tempDir); // store computes its local JSON path from cwd at import time
    vi.resetModules();

    const { createRecord, listRecords } = await import("@/lib/store");
    const when = new Date("2026-06-15T12:34:56.000Z");
    await createRecord("trades", { createdAt: when, updatedAt: when, tradeDateTime: when, instrument: "BTC" } as never);

    const trades = await listRecords("trades");
    expect(trades).toHaveLength(1);
    const trade = trades[0] as { createdAt: unknown; tradeDateTime: unknown };
    expect(trade.createdAt).toBeInstanceOf(Date);
    expect(trade.tradeDateTime).toBeInstanceOf(Date);
    expect((trade.tradeDateTime as Date).toISOString()).toBe(when.toISOString());
  });

  it("returns an empty collection when the store file does not exist yet", async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(tempDir, { recursive: true });
    process.chdir(tempDir);
    vi.resetModules();
    const { listRecords } = await import("@/lib/store");
    expect(await listRecords("trades")).toEqual([]);
  });
});
