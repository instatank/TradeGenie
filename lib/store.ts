import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { cache } from "react";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import type {
  ExchangeFill,
  ExchangeLedgerEntry,
  Asset,
  AssetNote,
  CustomOption,
  DailyJournal,
  FreeNote,
  ImportBatch,
  Lesson,
  MistakeTag,
  RawExecution,
  SavedView,
  Screenshot,
  Setup,
  Trade,
  TradeMistake,
  Transcript,
  WeeklyReview,
} from "@/lib/types";

export type CollectionName = keyof StoreShape;

export type StoreShape = {
  transcripts: Transcript[];
  dailyJournals: DailyJournal[];
  trades: Trade[];
  setups: Setup[];
  mistakeTags: MistakeTag[];
  tradeMistakes: TradeMistake[];
  lessons: Lesson[];
  rawExecutions: RawExecution[];
  importBatches: ImportBatch[];
  screenshots: Screenshot[];
  weeklyReviews: WeeklyReview[];
  assets: Asset[];
  assetNotes: AssetNote[];
  customOptions: CustomOption[];
  freeNotes: FreeNote[];
  savedViews: SavedView[];
  exchangeFills: ExchangeFill[];
  exchangeLedger: ExchangeLedgerEntry[];
};

const emptyStore: StoreShape = {
  transcripts: [],
  dailyJournals: [],
  trades: [],
  setups: [],
  mistakeTags: [],
  tradeMistakes: [],
  lessons: [],
  rawExecutions: [],
  importBatches: [],
  screenshots: [],
  weeklyReviews: [],
  assets: [],
  assetNotes: [],
  customOptions: [],
  freeNotes: [],
  savedViews: [],
  exchangeFills: [],
  exchangeLedger: [],
};

// Derived from the store shape itself so a new collection can never be left out
// of a backup. /api/export iterates this — it used to hardcode a list, which had
// already drifted (assets and assetNotes were missing from every backup).
export const collectionNames = Object.keys(emptyStore) as CollectionName[];

// Dev-only JSON store. TRADEGENIE_LOCAL_STORE lets a script (the capture eval
// harness) point at a throwaway file instead of the developer's own data.
const localStorePath = process.env.TRADEGENIE_LOCAL_STORE
  ? path.resolve(process.env.TRADEGENIE_LOCAL_STORE)
  : path.join(process.cwd(), "data", "tradeforge-store.json");

// Storage status, single source of truth.
// - "firestore": all required Firebase Admin credentials are present and valid-shaped.
// - "local": no Firebase credentials at all; safe only on a developer machine.
// - "invalid": partially configured — we refuse to proceed silently so we never
//   pretend to be durable while writing to an ephemeral fallback (or vice versa).
export type StorageStatus =
  | { mode: "firestore"; durable: true; source: "service-account" | "application-default" }
  | { mode: "local"; durable: false }
  | { mode: "invalid"; durable: false; missing: string[]; message: string };

export function storageStatus(): StorageStatus {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.trim();
  const adc = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();

  if (adc && !projectId && !clientEmail && !privateKey) {
    return { mode: "firestore", durable: true, source: "application-default" };
  }

  const anyServiceAccount = Boolean(projectId || clientEmail || privateKey);
  if (anyServiceAccount) {
    const missing: string[] = [];
    if (!projectId) missing.push("FIREBASE_PROJECT_ID");
    if (!clientEmail) missing.push("FIREBASE_CLIENT_EMAIL");
    if (!privateKey) missing.push("FIREBASE_PRIVATE_KEY");
    if (missing.length === 0) {
      return { mode: "firestore", durable: true, source: "service-account" };
    }
    return {
      mode: "invalid",
      durable: false,
      missing,
      message: `Firebase is partially configured. Missing: ${missing.join(", ")}. Set all three or none — never a partial set, otherwise data is unsafe.`,
    };
  }

  return { mode: "local", durable: false };
}

export function usesFirebase() {
  const status = storageStatus();
  if (status.mode === "invalid") throw new Error(status.message);
  return status.mode === "firestore";
}

export function newId() {
  return randomUUID();
}

// Request-scoped read cache. React's cache() hands back the same Map for the
// whole of one render or one server action, so a page whose helpers each want
// "trades" pays for one round trip instead of five. Measured collection reads
// per render, before -> after: Today 18 -> 11, a trade page 18 -> 12, /inbox
// 13 -> 7, /lessons 11 -> 8, /daily 11 -> 9. getTagVocabulary alone is 7 full
// scans and runs on nearly every page just to draw the tag chips, which is
// where most of the duplication came from. /search is 13 distinct collections
// and legitimately has nothing to dedupe.
//
// Deliberately per-request and no longer: two clicks a second apart must still
// see each other's writes, so every write invalidates its collection below.
// Outside a request (the seed and eval scripts) cache() degrades to "no
// memoization" instead of throwing, which is exactly what those want.
const readCache = cache(() => new Map<CollectionName, Promise<unknown>>());

function invalidateRead(collection: CollectionName) {
  readCache().delete(collection);
}

export async function listRecords<K extends CollectionName>(collection: K): Promise<StoreShape[K]> {
  const pending = readCache();
  const hit = pending.get(collection);
  if (hit) return hit as Promise<StoreShape[K]>;
  // Cache the promise, not the resolved value, so the callers inside one
  // Promise.all share a single round trip rather than each starting their own.
  const read = fetchRecords(collection).catch((error: unknown) => {
    // A failed read must not poison the rest of the request.
    pending.delete(collection);
    throw error;
  });
  pending.set(collection, read);
  return read as Promise<StoreShape[K]>;
}

async function fetchRecords<K extends CollectionName>(collection: K): Promise<StoreShape[K]> {
  if (usesFirebase()) {
    const snapshot = await firestore().collection(collection).get();
    return snapshot.docs.map((doc) => hydrate({ id: doc.id, ...doc.data() })) as StoreShape[K];
  }
  const store = await readLocalStore();
  return store[collection];
}

export async function getRecord<K extends CollectionName>(collection: K, id: string): Promise<StoreShape[K][number] | null> {
  if (usesFirebase()) {
    const doc = await firestore().collection(collection).doc(id).get();
    return doc.exists ? hydrate({ id: doc.id, ...doc.data() }) as StoreShape[K][number] : null;
  }
  const store = await readLocalStore();
  return store[collection].find((record) => record.id === id) ?? null;
}

export async function createRecord<K extends CollectionName>(
  collection: K,
  input: Omit<StoreShape[K][number], "id"> & { id?: string },
): Promise<StoreShape[K][number]> {
  const id = input.id ?? newId();
  const record = { ...input, id } as StoreShape[K][number];
  if (usesFirebase()) {
    await firestore().collection(collection).doc(id).set(dehydrate(record) as Record<string, unknown>);
    invalidateRead(collection);
    return record;
  }
  const store = await readLocalStore();
  (store[collection] as StoreShape[K][number][]).push(record);
  await writeLocalStore(store);
  invalidateRead(collection);
  return record;
}

export async function updateRecord<K extends CollectionName>(
  collection: K,
  id: string,
  patch: Partial<StoreShape[K][number]>,
): Promise<StoreShape[K][number]> {
  const existing = await getRecord(collection, id);
  if (!existing) throw new Error(`Missing ${collection} record ${id}`);
  const record = { ...existing, ...definedOnly(patch) } as StoreShape[K][number];
  if (usesFirebase()) {
    await firestore().collection(collection).doc(id).set(dehydrate(record) as Record<string, unknown>, { merge: true });
    invalidateRead(collection);
    return record;
  }
  const store = await readLocalStore();
  const list = store[collection] as StoreShape[K][number][];
  const index = list.findIndex((item) => item.id === id);
  list[index] = record;
  await writeLocalStore(store);
  invalidateRead(collection);
  return record;
}

export async function deleteWhere<K extends CollectionName>(
  collection: K,
  predicate: (record: StoreShape[K][number]) => boolean,
) {
  if (usesFirebase()) {
    const records = await listRecords(collection);
    const batch = firestore().batch();
    for (const record of records.filter(predicate)) {
      batch.delete(firestore().collection(collection).doc(record.id));
    }
    await batch.commit();
    invalidateRead(collection);
    return;
  }
  const store = await readLocalStore();
  store[collection] = (store[collection] as StoreShape[K][number][]).filter((record) => !predicate(record)) as StoreShape[K];
  await writeLocalStore(store);
  invalidateRead(collection);
}

export async function upsertBy<K extends CollectionName>(
  collection: K,
  predicate: (record: StoreShape[K][number]) => boolean,
  createInput: Omit<StoreShape[K][number], "id">,
  updateInput: Partial<StoreShape[K][number]>,
) {
  const records = await listRecords(collection);
  const existing = records.find(predicate);
  if (existing) return updateRecord(collection, existing.id, updateInput);
  return createRecord(collection, createInput);
}

async function readLocalStore(): Promise<StoreShape> {
  try {
    const raw = await readFile(localStorePath, "utf8");
    const parsed = JSON.parse(raw) as StoreShape;
    return hydrate({ ...emptyStore, ...parsed }) as StoreShape;
  } catch {
    return structuredClone(emptyStore);
  }
}

async function writeLocalStore(store: StoreShape) {
  await mkdir(path.dirname(localStorePath), { recursive: true });
  await writeFile(localStorePath, JSON.stringify(dehydrate(store), null, 2));
}

export function getFirestoreDb() {
  return firestore();
}

let firestoreClient: Firestore | null = null;

function firestore() {
  if (firestoreClient) return firestoreClient;
  if (!getApps().length) {
    const storageBucket = firebaseStorageBucketName();
    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
        }),
        ...(storageBucket ? { storageBucket } : {}),
      });
    } else {
      initializeApp({ credential: applicationDefault(), ...(storageBucket ? { storageBucket } : {}) });
    }
  }
  const client = getFirestore();
  try {
    // REST instead of gRPC. Every call we make is a one-shot read or write —
    // there are no listeners anywhere in the app — and gRPC pays for an HTTP/2
    // channel handshake on top of the OAuth token exchange on every cold start.
    // For a one-user journal the container is almost always cold, so that
    // handshake was being paid on very nearly every navigation.
    //
    // It also skips a module load: @grpc/grpc-js (4.8MB installed) is required
    // lazily on the first Firestore operation, and under preferRest it is
    // never required at all. Verified by inspecting require.cache after a call
    // with and without this setting. google-gax still loads either way.
    client.settings({ preferRest: true });
  } catch {
    // settings() refuses once the client has been used. Only reachable through
    // a dev hot-reload that dropped our memo while the client survived — in
    // which case the live client already has these settings.
  }
  firestoreClient = client;
  return firestoreClient;
}

export function firebaseStorageBucket(bucketName = firebaseStorageBucketName()) {
  firestore();
  return bucketName ? getStorage().bucket(bucketName) : getStorage().bucket();
}

function firebaseStorageBucketName() {
  if (process.env.FIREBASE_STORAGE_BUCKET) return process.env.FIREBASE_STORAGE_BUCKET;
  if (process.env.FIREBASE_PROJECT_ID) return `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`;
  return undefined;
}

function normalizePrivateKey(value: string) {
  return value
    .replace(/^"|"$/g, "")
    .replace(/\\\\n/g, "\n")
    .replace(/\\n/g, "\n");
}

function hydrate(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate();
  if (Array.isArray(value)) return value.map(hydrate);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    output[key] = shouldBeDate(key) && typeof inner === "string" ? new Date(inner) : hydrate(inner);
  }
  return output;
}

// Firestore REFUSES a document containing `undefined` and throws at write time;
// the local JSON store silently drops it, because that is what JSON.stringify
// does. That asymmetry is a trap: a patch carrying an optional field that a
// record predates works perfectly in dev and in the smoke test, then 500s in
// production the first time a real trader saves. It did exactly that — a review
// saved on a trade older than `checklistSteps` crashed with digest 516351032.
//
// So undefined is dropped here, at the one boundary every write already passes
// through, rather than guarded field by field at ~40 call sites. The rule this
// gives the rest of the app is a good one and now holds on BOTH backends:
// **an undefined value in a patch means "leave this field alone"**. Clearing a
// field is what `null` is for.
export function dehydrate(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(dehydrate);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (inner === undefined) continue;
    output[key] = dehydrate(inner);
  }
  return output;
}

/** The other half of the same rule, for the local store: an undefined patch
 *  value must not overwrite what's there, so both backends behave alike. */
function definedOnly<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function shouldBeDate(key: string) {
  return key === "date" || key.endsWith("At") || key.endsWith("DateTime") || key === "weekStart" || key === "weekEnd";
}
