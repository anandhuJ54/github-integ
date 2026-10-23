import { BrandWordmark } from "@/components/brand/logo";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { OrbField, GeminiRibbon } from "@/components/ai/gemini-gradient";
import { AiBadge, GradientButton } from "@/components/ai/ai-badge";
import { Sparkles, ArrowRight, Mail, Lock, Loader2 } from "lucide-react";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in · Experience.com Admin Console" },
      {
        name: "description",
        content:
          "Sign in to the Experience.com Admin Console. Access is invite-only for platform administrators, architects and analysts.",
      },
      { property: "og:title", content: "Sign in · Experience.com Admin Console" },
      {
        property: "og:description",
        content: "Invite-only sign-in for the Experience.com Admin Console.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  // Invite/allowlist only — public sign-up is disabled at the backend.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return setError(error.message);
    navigate({ to: "/console" as any });
  }

  return (
    <div className="min-h-screen w-full grid lg:grid-cols-2 bg-white">
      {/* LEFT — animated brand panel */}
      <div className="relative hidden lg:flex flex-col justify-between overflow-hidden p-12 text-white">
        <div className="absolute inset-0 bg-ink" />
        <OrbField />
        <div className="relative z-10">
          <div className="flex items-center gap-2">
            <BrandWordmark size={26} variant="dark" />
          </div>
          <AiBadge className="mt-6">Admin Console</AiBadge>
        </div>

        <div className="relative z-10 max-w-md">
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="text-5xl font-bold leading-[1.05] tracking-tight"
          >
            The next era of <span className="gemini-text">AI search</span> has arrived.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="mt-5 text-base text-white/80"
          >
            AI delivers answers from trusted voices. Make yours one of them — claim your profile, build your expertise graph, and become discoverable across Google, Perplexity, and every AI search surface.
          </motion.p>

          <div className="mt-10 grid grid-cols-3 gap-4">
            {[
              { k: "850-pt", v: "Search Rank Score" },
              { k: "61+", v: "Listings synced" },
              { k: "AI", v: "Schema generated" },
            ].map((s) => (
              <div key={s.v} className="rounded-2xl bg-white/10 backdrop-blur-md p-3 border border-white/15">
                <div className="text-lg font-bold">{s.k}</div>
                <div className="text-[11px] text-white/70 leading-tight mt-1">{s.v}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 text-xs text-white/60">
          © 2026 Experience.com · Trusted by Mortgage, Real Estate, Insurance, Health & 4,000+ verticals
        </div>
      </div>

      {/* RIGHT — auth form */}
      <div className="flex flex-col items-center justify-center p-8 lg:p-16 relative">
        <GeminiRibbon className="absolute top-0 inset-x-0" />
        <div className="w-full max-w-md">
          <h2 className="text-3xl font-bold tracking-tight text-ink">
            Admin Console sign-in
          </h2>
          <p className="mt-2 text-sm text-[color:var(--color-ink-2)]">
            Access is invite-only. Sign in with the credentials issued to you.
          </p>

          <form onSubmit={handleEmail} className="mt-8 space-y-3">
            <label className="block">
              <span className="sr-only">Email</span>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[color:var(--color-ink-3)]" />
                <input
                  type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full h-12 pl-10 pr-4 rounded-full bg-[color:var(--color-surface-2)] border border-transparent text-sm focus:outline-none focus:bg-white focus:border-[color:var(--color-g-blue)] transition-all"
                />
              </div>
            </label>
            <label className="block">
              <span className="sr-only">Password</span>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[color:var(--color-ink-3)]" />
                <input
                  type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full h-12 pl-10 pr-4 rounded-full bg-[color:var(--color-surface-2)] border border-transparent text-sm focus:outline-none focus:bg-white focus:border-[color:var(--color-g-blue)] transition-all"
                />
              </div>
            </label>
            {error && <p className="text-xs text-[color:var(--color-g-red)]">{error}</p>}
            <GradientButton type="submit" disabled={loading} className="w-full h-12">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>
                Sign in
                <ArrowRight className="h-4 w-4" />
              </>}
            </GradientButton>
          </form>

          <button
            type="button"
            onClick={async () => {
              setError(null);
              if (!email) return setError("Enter your email first, then tap Forgot password.");
              const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/reset-password`,
              });
              setError(error ? error.message : "Recovery email sent — check your inbox.");
            }}
            className="mt-4 w-full text-center text-xs text-[color:var(--color-ink-3)] hover:text-[color:var(--color-g-blue)] transition-colors"
          >
            Forgot password?
          </button>

          <p className="mt-4 text-center text-xs text-[color:var(--color-ink-3)]">
            Need access? Ask a Super Admin to create your account and assign a role.
          </p>


          <div className="mt-10 flex items-center justify-center gap-2 text-xs text-[color:var(--color-ink-3)]">
            <Sparkles className="h-3 w-3" /> Protected by enterprise-grade compliance
          </div>
        </div>
      </div>
    </div>
  );
}
