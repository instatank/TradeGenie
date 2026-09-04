import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, isCronRequest, roleForToken, siteAuthConfigured } from "@/lib/site-auth";

// A viewer may only GET/HEAD/OPTIONS. Every write in this app — every server
// action, and the one POST route handler (/api/import) — arrives as a POST
// (that's how React/Next dispatch a `<form action={serverAction}>` and how a
// server action bound via useActionState is fetched, JS or no JS), so blocking
// non-safe methods here is the single choke point that covers all of them at
// once, the same way `dehydrate()` is the one place undefined is stripped
// before Firestore ever sees it — no per-action opt-in to forget.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// These GET routes hand over the whole journal (or a tax CSV of it) as a
// downloadable file. That's a different thing from "browse the app" — a
// read-only link is for looking at entries, not for bulk-exporting them — so
// they stay owner-only even though they're safe methods.
// /api/cron/* is a third kind: a GET, but one that DOES something — it runs a
// scheduled job on demand. A read-only viewer could otherwise force exchange
// syncs and backups at will. The bearer-token exemption above is checked first
// and is unaffected, so this only ever narrows what a browser cookie can do.
const OWNER_ONLY_PREFIXES = ["/api/export", "/api/tax-export", "/api/cron"];

function readOnlyResponse() {
  return new NextResponse(
    "<!doctype html><html><head><meta charset=\"utf-8\"><title>Read-only</title></head>" +
      "<body style=\"font-family:system-ui,sans-serif;max-width:28rem;margin:15vh auto;padding:0 1.5rem;color:#1f2933;\">" +
      "<h1 style=\"font-size:1.25rem;\">Read-only access</h1>" +
      "<p>This password only lets you view the journal — it can&rsquo;t save changes.</p>" +
      "<p><a href=\"javascript:history.back()\">Go back</a></p>" +
      "</body></html>",
    { status: 403, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

// Runs on every request except the excluded paths in `config.matcher` below.
// Guards the whole app with one cookie check — see lib/site-auth.ts for why a
// full auth system isn't warranted here. No-ops entirely when SITE_PASSWORD
// isn't set, so an unconfigured deploy behaves exactly as before this existed.
export async function middleware(request: NextRequest) {
  if (!siteAuthConfigured()) return NextResponse.next();

  // The scheduled sync carries a bearer token instead of a cookie. Without this
  // it is redirected to /login and silently never runs — see lib/site-auth.ts.
  if (isCronRequest(request.nextUrl.pathname, request.headers.get("authorization"))) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(AUTH_COOKIE)?.value;
  const role = await roleForToken(cookie);

  if (role === "owner") return NextResponse.next();

  if (role === "viewer") {
    const ownerOnly = OWNER_ONLY_PREFIXES.some((prefix) => request.nextUrl.pathname.startsWith(prefix));
    if (SAFE_METHODS.has(request.method) && !ownerOnly) return NextResponse.next();
    return readOnlyResponse();
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!login|logout|_next/static|_next/image|favicon.ico).*)"],
};
