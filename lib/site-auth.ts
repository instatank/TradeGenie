// A single-trader gate, not a login system. There is one owner password
// (SITE_PASSWORD, set only in Vercel's env vars — never in code) and an
// optional second, weaker password (VIEWER_PASSWORD) for handing the journal
// to someone else to look at without handing over write access. No accounts,
// no user table, nothing Firestore needs to know about. This exists because
// Vercel's own Deployment Protection is a paid Pro feature and this app has
// exactly one owner, so paying for multi-seat auth infrastructure buys nothing.
//
// "Off until configured" — same rule as the SignalDesk bridge and the AI path:
// no SITE_PASSWORD means the gate does not run at all, so a fresh clone or a
// preview deploy without the env var behaves exactly as it always did rather
// than locking someone out. Once SITE_PASSWORD is set, every route in
// middleware.ts's matcher requires the cookie. VIEWER_PASSWORD is its own
// separate "off until configured": leaving it unset means there is no viewer
// role at all, only the owner gate that already existed.
//
// The cookie is not a password: it's a SHA-256 digest computed with Web Crypto
// so the same code runs in the Edge middleware runtime and in the Node
// server-action runtime. The owner and viewer tokens are hashed with different
// inputs (see roleTag below) so the two can never collide and a cookie value
// alone tells you which role it belongs to — no separate "role" field to keep
// in sync with the cookie, so there is nothing for the two to drift out of
// agreement with. Rotating either password invalidates every cookie for that
// role, same as before.
export const AUTH_COOKIE = "tg_auth";
// Non-secret, non-httpOnly: readable by client components so the UI can show
// "read-only" affordances. It carries only a role label, never a credential —
// the actual access control is AUTH_COOKIE, checked server-side in
// middleware.ts on every request. A forged ROLE_COOKIE grants nothing.
export const ROLE_COOKIE = "tg_role";
const SALT = "tradegenie-site-gate";

export type Role = "owner" | "viewer";

export function siteAuthConfigured(): boolean {
  return Boolean(process.env.SITE_PASSWORD);
}

export function viewerAuthConfigured(): boolean {
  return Boolean(process.env.VIEWER_PASSWORD);
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function roleTag(role: Role): string {
  // The owner tag is left as it always was, so a change that only adds the
  // viewer role never signs the owner out of an existing session.
  return role === "owner" ? "" : `${role}:`;
}

export async function expectedAuthToken(): Promise<string | null> {
  const password = process.env.SITE_PASSWORD;
  if (!password) return null;
  return sha256Hex(`${SALT}:${roleTag("owner")}${password}`);
}

export async function expectedViewerToken(): Promise<string | null> {
  const password = process.env.VIEWER_PASSWORD;
  if (!password) return null;
  return sha256Hex(`${SALT}:${roleTag("viewer")}${password}`);
}

export async function checkPassword(candidate: string): Promise<string | null> {
  const password = process.env.SITE_PASSWORD;
  if (!password || !candidate || candidate !== password) return null;
  return sha256Hex(`${SALT}:${roleTag("owner")}${password}`);
}

// Tries the owner password first, then the viewer password (if configured).
// The login form has one field for both — whoever holds either password gets
// in as the role that password belongs to.
export async function authenticate(candidate: string): Promise<{ token: string; role: Role } | null> {
  const ownerToken = await checkPassword(candidate);
  if (ownerToken) return { token: ownerToken, role: "owner" };

  const viewerPassword = process.env.VIEWER_PASSWORD;
  if (viewerPassword && candidate && candidate === viewerPassword) {
    return { token: await sha256Hex(`${SALT}:${roleTag("viewer")}${viewerPassword}`), role: "viewer" };
  }
  return null;
}

// The one place a cookie value is turned back into a role — used by
// middleware.ts to decide what a request may do, and by lib/role.ts for
// server components that need to know who is looking. Pure and
// framework-agnostic on purpose: it has to run in the Edge middleware runtime,
// which does not have next/headers.
export async function roleForToken(cookie: string | undefined | null): Promise<Role | null> {
  if (!cookie) return null;
  const owner = await expectedAuthToken();
  if (owner && cookie === owner) return "owner";
  const viewer = await expectedViewerToken();
  if (viewer && cookie === viewer) return "viewer";
  return null;
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
