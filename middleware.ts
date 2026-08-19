import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, expectedAuthToken, siteAuthConfigured } from "@/lib/site-auth";

// Runs on every request except the excluded paths in `config.matcher` below.
// Guards the whole app with one cookie check — see lib/site-auth.ts for why a
// full auth system isn't warranted here. No-ops entirely when SITE_PASSWORD
// isn't set, so an unconfigured deploy behaves exactly as before this existed.
export async function middleware(request: NextRequest) {
  if (!siteAuthConfigured()) return NextResponse.next();

  const expected = await expectedAuthToken();
  const cookie = request.cookies.get(AUTH_COOKIE)?.value;
  if (cookie && expected && cookie === expected) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
