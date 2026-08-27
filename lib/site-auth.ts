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

// The scheduled sync is the one caller that has no browser and therefore no
// cookie. Vercel sends its cron requests with `Authorization: Bearer
// $CRON_SECRET`, so that is what the gate accepts instead.
//
// Verified, not assumed: without this, a cron call to /api/cron/* is answered
// with `307 → /login`. The runner follows the redirect, gets a perfectly good
// login page, records a success, and the sync never runs. Nothing errors and
// nothing logs — the only symptom is data quietly not arriving.
// `npm run check:cron` asserts all three cases so it cannot come back.
//
// Deliberately strict:
//   - No CRON_SECRET set means NO exemption. An unset secret must never turn
//     into an open door; it falls through to the cookie check as before.
//   - Only paths under /api/cron/ are eligible, so a leaked secret cannot read
//     the journal or the full /api/export backup.
//   - Compared with a length-safe constant-time check, because a bearer token
//     is attacker-supplied in a way the site password never is.
const CRON_PREFIX = "/api/cron/";

export function cronAuthConfigured(): boolean {
  return Boolean(process.env.CRON_SECRET);
}

export function isCronRequest(pathname: string, authorization: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (!pathname.startsWith(CRON_PREFIX)) return false;
  if (!authorization) return false;

  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) return false;
  return timingSafeEqual(authorization.slice(prefix.length), secret);
}

/** Constant-time for equal lengths, and length itself is not a useful leak for
 *  a secret the owner chooses. Node's timingSafeEqual isn't available in the
 *  Edge middleware runtime, so this is done by hand. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}
