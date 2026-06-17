import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import type {
  DailyJournal,
  ImportBatch,
  Lesson,
  MistakeTag,
  RawExecution,
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
};

const localStorePath = path.join(process.cwd(), "data", "tradeforge-store.json");

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

export async function listRecords<K extends CollectionName>(collection: K): Promise<StoreShape[K]> {
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
    return record;
  }
  const store = await readLocalStore();
  (store[collection] as StoreShape[K][number][]).push(record);
  await writeLocalStore(store);
  return record;
}

export async function updateRecord<K extends CollectionName>(
  collection: K,
  id: string,
  patch: Partial<StoreShape[K][number]>,
): Promise<StoreShape[K][number]> {
  const existing = await getRecord(collection, id);
  if (!existing) throw new Error(`Missing ${collection} record ${id}`);
  const record = { ...existing, ...patch } as StoreShape[K][number];
  if (usesFirebase()) {
    await firestore().collection(collection).doc(id).set(dehydrate(record) as Record<string, unknown>, { merge: true });
    return record;
  }
  const store = await readLocalStore();
  const list = store[collection] as StoreShape[K][number][];
  const index = list.findIndex((item) => item.id === id);
  list[index] = record;
  await writeLocalStore(store);
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
    return;
  }
  const store = await readLocalStore();
  store[collection] = (store[collection] as StoreShape[K][number][]).filter((record) => !predicate(record)) as StoreShape[K];
  await writeLocalStore(store);
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

function firestore() {
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
  return getFirestore();
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

function dehydrate(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(dehydrate);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    output[key] = dehydrate(inner);
  }
  return output;
}

function shouldBeDate(key: string) {
  return key === "date" || key.endsWith("At") || key.endsWith("DateTime") || key === "weekStart" || key === "weekEnd";
}
