import { cookies } from "next/headers";
import { AUTH_COOKIE, roleForToken, siteAuthConfigured, type Role } from "@/lib/site-auth";

// Server-component-only counterpart to lib/site-auth.ts's roleForToken: reads
// the real (httpOnly) cookie via next/headers, which isn't available in the
// Edge middleware runtime — that's why this lives in its own file rather than
// folded into site-auth.ts.
//
// When the gate isn't configured at all there is no concept of a viewer link,
// so everyone is the owner — same "off until configured" behavior the app had
// before a viewer role existed.
export async function getRole(): Promise<Role> {
  if (!siteAuthConfigured()) return "owner";
  const cookie = (await cookies()).get(AUTH_COOKIE)?.value;
  return (await roleForToken(cookie)) ?? "owner";
}

export async function isViewer(): Promise<boolean> {
  return (await getRole()) === "viewer";
}
