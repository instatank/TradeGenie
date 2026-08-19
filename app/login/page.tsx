import { Lock } from "lucide-react";
import { loginAction } from "@/app/login/actions";

// One field, one button — the same friction-first shape as everything else in
// the app. Not a real account system; see lib/site-auth.ts for why.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = params?.next ?? "/";

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center px-4">
      <div className="panel space-y-4">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-forge-blue" aria-hidden="true" />
          <h1 className="font-semibold">TradeGenie is locked</h1>
        </div>
        <form action={loginAction} className="space-y-3">
          <input type="hidden" name="next" value={next} />
          <label className="sr-only" htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoFocus
            required
            placeholder="Password"
            className="input"
          />
          {params?.error ? (
            <p className="text-sm text-forge-red">Wrong password. Try again.</p>
          ) : null}
          <button className="button w-full" type="submit">Unlock</button>
        </form>
      </div>
    </div>
  );
}
