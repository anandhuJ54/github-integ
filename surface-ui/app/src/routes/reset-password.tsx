import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@v3/ui/integrations/supabase/client";
import { GeminiRibbon } from "@v3/ui/components/ai/gemini-gradient";
import { GradientButton } from "@v3/ui/components/ai/ai-badge";
import { Lock, Loader2, CheckCircle2, Mail } from "lucide-react";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Set a new password · Experience.com Admin Console" },
      {
        name: "description",
        content:
          "Set a new password for your Experience.com Admin Console account using a secure recovery link.",
      },
      { property: "og:title", content: "Set a new password · Experience.com Admin Console" },
      {
        property: "og:description",
        content: "Complete password recovery for the Experience.com Admin Console.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const url = new URL(window.location.href);
      const hash = new URLSearchParams(url.hash.replace(/^#/, ""));

      // Newer recovery links carry ?token_hash=...&type=recovery
      const tokenHash = url.searchParams.get("token_hash");
      const type = url.searchParams.get("type");
      if (tokenHash && type) {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: type as "recovery",
        });
        if (verifyError && !cancelled) setError(verifyError.message);
      }

      // PKCE style links carry ?code=...
      const code = url.searchParams.get("code");
      if (code) {
        const { error: codeError } = await supabase.auth.exchangeCodeForSession(code);
        if (codeError && !cancelled) setError(codeError.message);
      }

      // Implicit links carry the tokens in the hash
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (sessionError && !cancelled) setError(sessionError.message);
      }

      const hashError = hash.get("error_description") ?? url.searchParams.get("error_description");
      if (hashError && !cancelled) setError(decodeURIComponent(hashError));

      const { data } = await supabase.auth.getSession();
      if (!cancelled) {
        setReady(Boolean(data.session));
        setChecking(false);
      }
    }

    void bootstrap();

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) {
        setReady(true);
        setChecking(false);
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("Passwords do not match.");
    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) {
      return setError(
        /session|jwt|auth/i.test(updateError.message)
          ? "Your recovery link is no longer valid. Request a new one below and open it from your email."
          : updateError.message,
      );
    }
    setDone(true);
    setTimeout(() => navigate({ to: "/" as any }), 1200);
  }

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSending(true);
    const { error: sendError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSending(false);
    if (sendError) return setError(sendError.message);
    setSent(true);
  }

  const inputClass =
    "w-full h-12 pl-10 pr-4 rounded-full bg-[color:var(--color-surface-2)] border border-transparent text-sm focus:outline-none focus:bg-white focus:border-[color:var(--color-g-blue)] transition-all";

  return (
    <div className="min-h-screen w-full grid place-items-center bg-white p-8 relative">
      <GeminiRibbon className="absolute top-0 inset-x-0" />
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-bold tracking-tight text-ink">Set a new password</h1>
        <p className="mt-2 text-sm text-[color:var(--color-ink-2)]">
          {checking
            ? "Checking your recovery link…"
            : ready
              ? "Choose a password for your Admin Console account."
              : "This page needs a fresh recovery link — request one below, then open it from your email."}
        </p>

        {done ? (
          <div className="mt-8 flex items-center gap-2 text-sm text-[color:var(--color-ink-2)]">
            <CheckCircle2 className="h-4 w-4 text-[color:var(--color-g-green,#16a34a)]" />
            Password updated — taking you to the console…
          </div>
        ) : (
          <>
            {ready ? (
              <form onSubmit={handleSubmit} className="mt-8 space-y-3">
                <label className="block">
                  <span className="sr-only">New password</span>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[color:var(--color-ink-3)]" />
                    <input
                      type="password"
                      required
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="New password"
                      className={inputClass}
                    />
                  </div>
                </label>
                <label className="block">
                  <span className="sr-only">Confirm password</span>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[color:var(--color-ink-3)]" />
                    <input
                      type="password"
                      required
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder="Confirm password"
                      className={inputClass}
                    />
                  </div>
                </label>
                {error && <p className="text-xs text-[color:var(--color-g-red)]">{error}</p>}
                <GradientButton type="submit" disabled={loading} className="w-full h-12">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save password"}
                </GradientButton>
              </form>
            ) : sent ? (
              <div className="mt-8 space-y-3 text-sm text-[color:var(--color-ink-2)]">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-[color:var(--color-g-green,#16a34a)]" />
                  Recovery email sent to {email.trim()}.
                </div>
                <p className="text-xs">
                  Open the newest email and click the link — each link works once and expires quickly. Open it in this
                  same browser.
                </p>
                <button
                  type="button"
                  className="text-xs font-semibold text-[color:var(--color-g-blue)]"
                  onClick={() => setSent(false)}
                >
                  Send another link
                </button>
              </div>
            ) : (
              <form onSubmit={sendLink} className="mt-8 space-y-3">
                <label className="block">
                  <span className="sr-only">Email address</span>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[color:var(--color-ink-3)]" />
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@experience.com"
                      className={inputClass}
                    />
                  </div>
                </label>
                {error && <p className="text-xs text-[color:var(--color-g-red)]">{error}</p>}
                <GradientButton type="submit" disabled={sending || !email.trim()} className="w-full h-12">
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Email me a recovery link"}
                </GradientButton>
                <p className="text-xs text-[color:var(--color-ink-3)]">
                  Already have a link? Open it from your email — it must be the most recent one, and it can only be used
                  once.
                </p>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}

