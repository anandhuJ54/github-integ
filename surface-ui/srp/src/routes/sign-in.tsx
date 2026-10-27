import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Button } from "@v3/shared/components/ui/button";
import { Input } from "@v3/shared/components/ui/input";
import { Label } from "@v3/shared/components/ui/label";
import { getAuthProvider } from "@v3/state/auth";
import { whenSessionReady } from "@v3/state/session/bootstrap";
import { store } from "@v3/state/store";
import { safeLanding, signInErrorMessage } from "@v3/srp/utils/sign-in";

export const Route = createFileRoute("/sign-in")({
  ssr: false,
  head: () => ({ meta: [{ title: "Sign in · Experience.com" }] }),
  // Already signed in: go straight to the person's home instead of showing the form.
  beforeLoad: async () => {
    const session = await whenSessionReady(store);
    if (session.status !== "authed") return;
    const landing = (await getAuthProvider().getSession())?.landingPath;
    throw redirect({ to: safeLanding(landing) as "/" });
  },
  component: SignInPage,
});

function SignInPage() {
  const navigate = useNavigate();
  const provider = getAuthProvider();
  const supported = typeof provider.signInWithPassword === "function";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading || !provider.signInWithPassword) return;
    setError(null);
    setLoading(true);
    try {
      const { landingPath } = await provider.signInWithPassword(email.trim(), password);
      await navigate({ to: safeLanding(landingPath) as "/", replace: true });
    } catch (err) {
      setError(signInErrorMessage(err));
      setPassword("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[color:var(--color-surface-2)] px-6 py-12">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5 rounded-xl border border-slate-200 bg-white p-8">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink">Sign in</h1>
          <p className="mt-1 text-sm text-slate-500">Use the email and password for your professional seat.</p>
        </div>

        {!supported ? (
          <p role="alert" className="text-sm text-slate-600">
            This build signs in through the Admin Console. <a className="underline" href="/auth">Go to the Admin Console sign-in</a>.
          </p>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={loading || !email || !password}>
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </>
        )}
      </form>
    </main>
  );
}
