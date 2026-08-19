"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, checkPassword, siteAuthConfigured } from "@/lib/site-auth";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function loginAction(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (!siteAuthConfigured()) {
    redirect(safeNext);
  }

  const token = await checkPassword(password);
  if (!token) {
    redirect(`/login?next=${encodeURIComponent(safeNext)}&error=1`);
  }

  (await cookies()).set(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: ONE_YEAR_SECONDS,
    path: "/",
  });
  redirect(safeNext);
}

export async function logoutAction() {
  (await cookies()).delete(AUTH_COOKIE);
  redirect("/login");
}
