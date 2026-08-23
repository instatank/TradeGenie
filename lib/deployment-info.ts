// Where this app is actually running, and where its database actually lives.
//
// These two facts decide the single biggest remaining slice of page-load
// latency: every dynamic page is a round trip from the browser to the Vercel
// function and from that function to Firestore. Moving the function closer to
// the owner only helps if the database is close to the function too — otherwise
// it just swaps a short function->database hop for a long one. Neither fact is
// visible from the app or from the Vercel dashboard side by side, so this
// module reports both in one place (shown on /settings).
//
// Never load-bearing. Same rule as the SignalDesk bridge and the AI path: a
// short timeout, every failure returns a reason string instead of throwing, and
// nothing here can make a page fail to render.

import { getApps } from "firebase-admin/app";
import { getFirestoreDb, storageStatus } from "@/lib/store";

const LOOKUP_TIMEOUT_MS = 3000;

export type DeploymentInfo = {
  /** Vercel region code the function ran in, e.g. "iad1". Null when not on Vercel. */
  functionRegion: string | null;
  /** Firestore location id, e.g. "asia-south1" or "nam5". Null if it couldn't be read. */
  firestoreLocation: string | null;
  /** Plain-English reason firestoreLocation is null, when it is. */
  firestoreLocationNote: string | null;
};

export function functionRegion(): string | null {
  return process.env.VERCEL_REGION?.trim() || null;
}

/**
 * Ask Firestore where it lives, using the credentials the app already holds.
 * The location is fixed when the database is created and can never change, so
 * a wrong answer here would send us to the wrong Vercel region.
 */
export async function firestoreLocation(): Promise<{ location: string | null; note: string | null }> {
  if (storageStatus().mode !== "firestore") {
    return { location: null, note: "Not using Firestore — nothing to locate." };
  }
  try {
    getFirestoreDb(); // ensures the admin app is initialised
    const app = getApps()[0];
    const projectId = process.env.FIREBASE_PROJECT_ID?.trim() || app?.options.projectId;
    const credential = app?.options.credential;
    if (!projectId || !credential) {
      return { location: null, note: "No project id or credential on the admin app." };
    }
    const { access_token: token } = await credential.getAccessToken();
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) },
    );
    if (!response.ok) {
      // Most likely the service account lacks datastore.databases.list. Not
      // worth widening its roles for a diagnostic — just say so.
      return { location: null, note: `Firestore admin API said ${response.status}. The service account may not be allowed to list databases.` };
    }
    const body = (await response.json()) as { databases?: { name?: string; locationId?: string }[] };
    const primary =
      body.databases?.find((database) => database.name?.endsWith("/(default)")) ?? body.databases?.[0];
    if (!primary?.locationId) return { location: null, note: "Firestore returned no location for this project." };
    return { location: primary.locationId, note: null };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { location: null, note: `Couldn't reach the Firestore admin API: ${reason}` };
  }
}

export async function deploymentInfo(): Promise<DeploymentInfo> {
  const { location, note } = await firestoreLocation();
  return { functionRegion: functionRegion(), firestoreLocation: location, firestoreLocationNote: note };
}

/**
 * Are the function and the database in the same part of the world? A page load
 * pays this distance on every uncached navigation, so a mismatch is worth
 * naming explicitly rather than leaving as two region codes to eyeball.
 */
export function colocation(info: DeploymentInfo): { verdict: "together" | "apart" | "unknown"; detail: string } {
  const fn = info.functionRegion;
  const db = info.firestoreLocation;
  if (!fn || !db) return { verdict: "unknown", detail: "Need both the function region and the Firestore location to say." };
  const fnContinent = vercelContinent(fn);
  const dbContinent = firestoreContinent(db);
  if (!fnContinent || !dbContinent) return { verdict: "unknown", detail: `Unrecognised region pair (${fn} / ${db}).` };
  if (fnContinent === dbContinent) {
    return { verdict: "together", detail: `Both in ${fnContinent}. Each database read is a short hop.` };
  }
  return {
    verdict: "apart",
    detail: `The function runs in ${fnContinent} but the database is in ${dbContinent}. Every read crosses that gap.`,
  };
}

// Only the codes worth telling apart at continent scale — enough to answer
// "is my database near my function", not a full region atlas.
function vercelContinent(region: string): string | null {
  if (/^(iad|cle|pdx|sfo|dev)/.test(region)) return "North America";
  if (/^(bom|sin|hnd|icn|kix|hkg)/.test(region)) return "Asia";
  if (/^(dub|fra|lhr|cdg|arn)/.test(region)) return "Europe";
  if (/^(syd)/.test(region)) return "Australia";
  if (/^(gru)/.test(region)) return "South America";
  if (/^(cpt)/.test(region)) return "Africa";
  return null;
}

function firestoreContinent(location: string): string | null {
  if (/^(nam|us-)/.test(location)) return "North America";
  if (/^(asia|asia-|australia)/.test(location)) return location.startsWith("australia") ? "Australia" : "Asia";
  if (/^(eur|europe)/.test(location)) return "Europe";
  if (/^(southamerica)/.test(location)) return "South America";
  if (/^(africa)/.test(location)) return "Africa";
  if (/^(me-)/.test(location)) return "Middle East";
  return null;
}
