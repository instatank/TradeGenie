"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, ROLE_COOKIE, authenticate, siteAuthConfigured } from "@/lib/site-auth";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function loginAction(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (!siteAuthConfigured()) {
    redirect(safeNext);
  }

  const result = await authenticate(password);
  if (!result) {
    redirect(`/login?next=${encodeURIComponent(safeNext)}&error=1`);
  }

  const jar = await cookies();
  jar.set(AUTH_COOKIE, result.token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: ONE_YEAR_SECONDS,
    path: "/",
  });
  // Readable, non-secret: lets client components (e.g. SaveBar) show a
  // read-only affordance without ever seeing the real auth cookie.
  jar.set(ROLE_COOKIE, result.role, {
    httpOnly: false,
    secure: true,
    sameSite: "lax",
    maxAge: ONE_YEAR_SECONDS,
    path: "/",
  });
  redirect(safeNext);
}
