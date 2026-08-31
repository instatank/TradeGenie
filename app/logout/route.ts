import { NextResponse } from "next/server";
import { AUTH_COOKIE, ROLE_COOKIE } from "@/lib/site-auth";

// A plain GET route rather than a server action: every write in the app is
// gated to the owner by middleware.ts (see the SAFE_METHODS comment there),
// and a viewer clearing their own cookie is not a write to the journal — it
// just shouldn't have to fight that gate to do it.
export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.delete(AUTH_COOKIE);
  response.cookies.delete(ROLE_COOKIE);
  return response;
}
