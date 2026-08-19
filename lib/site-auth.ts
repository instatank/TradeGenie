// A single-trader gate, not a login system. There is one password (SITE_PASSWORD,
// set only in Vercel's env vars — never in code) and one long-lived cookie; no
// accounts, no user table, nothing Firestore needs to know about. This exists
// because Vercel's own Deployment Protection is a paid Pro feature and this app
// has exactly one user, so paying for multi-seat auth infrastructure buys nothing.
//
// "Off until configured" — same rule as the SignalDesk bridge and the AI path:
// no SITE_PASSWORD means the gate does not run at all, so a fresh clone or a
// preview deploy without the env var behaves exactly as it always did rather
// than locking someone out. Once SITE_PASSWORD is set, every route in
// middleware.ts's matcher requires the cookie.
//
// The cookie is not the password: it's a SHA-256 digest of the password plus a
// fixed salt, computed with Web Crypto so the same code runs in the Edge
// middleware runtime and in the Node server-action runtime. Rotating
// SITE_PASSWORD invalidates every existing cookie automatically, since the
// digest middleware expects changes with it.
export const AUTH_COOKIE = "tg_auth";
const SALT = "tradegenie-site-gate";

export function siteAuthConfigured(): boolean {
  return Boolean(process.env.SITE_PASSWORD);
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function expectedAuthToken(): Promise<string | null> {
  const password = process.env.SITE_PASSWORD;
  if (!password) return null;
  return sha256Hex(`${SALT}:${password}`);
}

export async function checkPassword(candidate: string): Promise<string | null> {
  const password = process.env.SITE_PASSWORD;
  if (!password || !candidate || candidate !== password) return null;
  return sha256Hex(`${SALT}:${password}`);
}
