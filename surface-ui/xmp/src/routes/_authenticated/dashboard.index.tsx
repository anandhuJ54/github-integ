import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { supabase } from "@v3/ui/integrations/supabase/client";
import { api } from "@v3/ui/lib/server-fn";
import { Avatar, AvatarFallback, AvatarImage } from "@v3/ui/components/ui/avatar";
import { Button } from "@v3/ui/components/ui/button";
import { Card } from "@v3/ui/components/ui/card";
import { DashboardShell } from "@v3/xmp/components/dashboard-shell";
import { ScoreGauge } from "@v3/xmp/components/ai/score-gauge";
import { cn } from "@v3/ui/lib/utils";

export const Route = createFileRoute("/_authenticated/dashboard/")({
  ssr: false,
  component: DashboardPage,
});


type Professional = {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  headline: string | null;
  photo_url: string | null;
  address_city: string | null;
  gcid: string | null;
  local_rank: number | null;
  local_rank_of: number | null;
};

type Score = {
  total_score: number | null;
  max_possible: number | null;
  score_change_7d: number | null;
  score_reviews: number | null;
  score_web_analytics: number | null;
  score_profile: number | null;
  score_connections: number | null;
  score_listings: number | null;
  score_content: number | null;
  gaps: any;
  next_milestone: string | null;
};

type PlgRule = {
  id: string;
  headline: string;
  body: string | null;
  cta_text: string | null;
  cta_url: string | null;
  cta_action: string | null;
  icon: string | null;
  priority: number | null;
};

type Subscription = { plan_name: string | null; status: string | null };

const BUCKETS = [
  { key: "score_reviews", label: "Reviews & Replies", max: 200, color: "bg-amber-500" },
  { key: "score_web_analytics", label: "Web Analytics", max: 150, color: "bg-blue-500" },
  { key: "score_profile", label: "Profile Completion", max: 150, color: "bg-violet-500" },
  { key: "score_connections", label: "Connections", max: 150, color: "bg-emerald-500" },
  { key: "score_listings", label: "Listings", max: 100, color: "bg-rose-500" },
  { key: "score_content", label: "Content & Expertise", max: 100, color: "bg-cyan-500" },
] as const;

function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [pro, setPro] = useState<Professional | null>(null);
  const [score, setScore] = useState<Score | null>(null);
  const [plg, setPlg] = useState<PlgRule[]>([]);
  const [sub, setSub] = useState<Subscription | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        window.location.href = "/auth";
        return;
      }
      // the signed-in user's professional, its newest score, subscription and PLG rules (server side)
      const data = await api.get<{
        pro: Professional | null;
        score?: Score | null;
        subscription?: Subscription | null;
        plg?: PlgRule[];
      }>("/xmp/dashboard/home");

      if (!data.pro) {
        setLoading(false);
        return;
      }
      setPro(data.pro);

      setScore(data.score ?? null);
      setSub(data.subscription ?? null);
      setPlg(data.plg ?? []);
      setLoading(false);
    })();
  }, []);

  const name = useMemo(() => {
    if (!pro) return "";
    return pro.display_name || [pro.first_name, pro.last_name].filter(Boolean).join(" ");
  }, [pro]);

  const isPro = sub?.status === "active" && (sub.plan_name ?? "").toLowerCase().includes("pro");
  const total = score?.total_score ?? 0;
  const max = score?.max_possible ?? 850;
  const pct = Math.min(100, Math.round((total / max) * 100));
  const change = score?.score_change_7d ?? 0;
  const topPlg = plg[0];

  return (
    <DashboardShell title="My Dashboard" user={{ name, photo_url: pro?.photo_url ?? null }}>
      <div className="p-8 max-w-[1400px] mx-auto">
        {loading ? (
          <div className="text-[color:var(--color-ink-3)] text-sm">Loading…</div>
        ) : !pro ? (
          <Card className="p-8 text-center">
            <p className="text-slate-700 mb-3">No professional profile is linked to your account yet.</p>
            <Button asChild><Link to="/">Find your profile</Link></Button>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* HERO — gradient command card */}
            <div className="relative overflow-hidden rounded-3xl bg-ink text-white shadow-[0_24px_60px_-20px_rgba(66,133,244,0.4)]">
              <div className="absolute inset-0 opacity-90" style={{ background: "var(--gradient-gemini)", backgroundSize: "200% 200%", animation: "gemini-drift 14s ease infinite" }} />
              <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-ink/80 via-ink/40 to-transparent" />
              <div className="relative grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-6 p-6 sm:p-10 items-center">
                <div className="flex items-start gap-5 min-w-0">
                  <Avatar className="h-20 w-20 ring-4 ring-white/30 shrink-0">
                    {pro.photo_url ? <AvatarImage src={pro.photo_url} alt={name} /> : null}
                    <AvatarFallback className="bg-white text-ink font-semibold">
                      {name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-3xl font-bold tracking-tight text-white truncate">{name}</h2>
                      {isPro && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-g-yellow)] text-ink px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                          <Sparkles className="h-3 w-3" /> PRO
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-white/80 mt-1 truncate">{pro.job_title || pro.headline || "—"}</p>
                    {pro.local_rank && pro.local_rank_of && pro.address_city ? (
                      <p className="text-sm text-white/75 mt-3">
                        Ranked <span className="font-bold text-white">#{pro.local_rank}</span> of {pro.local_rank_of} in {pro.address_city}
                      </p>
                    ) : null}
                    {topPlg ? (
                      <div className="mt-5 inline-flex items-start gap-3 rounded-2xl bg-white/15 backdrop-blur-md border border-white/20 px-4 py-3 max-w-xl">
                        <Sparkles className="h-4 w-4 mt-0.5 shrink-0 text-[color:var(--color-g-yellow)]" />
                        <div className="min-w-0">
                          <div className="text-[10px] uppercase tracking-widest font-semibold text-white/70">Suggested action</div>
                          <p className="text-sm text-white font-medium mt-0.5">{topPlg.headline}</p>
                          {topPlg.cta_text ? (
                            <button className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white text-ink text-xs font-semibold px-3 py-1.5 hover:-translate-y-0.5 transition-transform">
                              {topPlg.cta_url ? <a href={topPlg.cta_url}>{topPlg.cta_text}</a> : topPlg.cta_text}
                              <ArrowRight className="h-3 w-3" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center justify-center">
                  <div className="rounded-3xl bg-white/10 backdrop-blur-md border border-white/20 p-6">
                    <ScoreGauge score={total} max={max} delta={change} size={210} />
                  </div>
                </div>
              </div>
            </div>

            {/* Score breakdown bar */}
            <Card className="p-6 border-[color:var(--color-hairline)] rounded-2xl">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h3 className="text-sm font-semibold text-ink">Search Rank Score Overview</h3>
                <div className="text-sm text-[color:var(--color-ink-2)]">
                  <span className="font-bold text-ink tabular-nums">{total}</span> of {max} possible
                </div>
              </div>
              <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-[color:var(--color-surface-3)]">
                {BUCKETS.map((b) => {
                  const v = (score?.[b.key as keyof Score] as number) ?? 0;
                  const w = (v / max) * 100;
                  return (
                    <div key={b.key} className={cn("h-full", b.color)} style={{ width: `${w}%` }} title={`${b.label}: ${v}/${b.max}`} />
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
                {BUCKETS.map((b) => {
                  const v = (score?.[b.key as keyof Score] as number) ?? 0;
                  return (
                    <div key={b.key} className="flex items-center gap-1.5 text-xs">
                      <span className={cn("h-2 w-2 rounded-full", b.color)} />
                      <span className="text-[color:var(--color-ink-2)]">{b.label}</span>
                      <span className="text-[color:var(--color-ink-3)] tabular-nums">{v}/{b.max}</span>
                    </div>
                  );
                })}
              </div>
              {topPlg ? (
                <div className="mt-5 rounded-xl bg-[color:var(--color-g-yellow-soft)] border border-[color:var(--color-g-yellow)]/30 p-3 flex items-start gap-2.5">
                  <Sparkles className="h-4 w-4 text-[color:var(--color-g-yellow)] mt-0.5 shrink-0" />
                  <div>
                    <span className="text-xs font-bold uppercase tracking-widest text-ink">Pro Tip: </span>
                    <span className="text-sm text-[color:var(--color-ink-2)]">{topPlg.body || topPlg.headline}</span>
                  </div>
                </div>
              ) : null}
            </Card>

            {/* 2x3 bucket cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {BUCKETS.map((b, i) => {
                const v = (score?.[b.key as keyof Score] as number) ?? 0;
                const p = Math.min(100, Math.round((v / b.max) * 100));
                return (
                  <Card key={b.key} className="group relative p-5 rounded-2xl border-[color:var(--color-hairline)] hover:shadow-[0_8px_24px_rgba(60,64,67,0.08)] hover:-translate-y-0.5 transition-all overflow-hidden">
                    <div aria-hidden className="absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-10 group-hover:opacity-20 transition-opacity" style={{ background: "var(--gradient-gemini)" }} />
                    <div className="relative flex items-start justify-between">
                      <div>
                        <h4 className="text-sm font-semibold text-ink">{b.label}</h4>
                        <p className="text-3xl font-bold text-ink mt-1 tabular-nums">
                          {v}<span className="text-sm font-normal text-[color:var(--color-ink-3)]">/{b.max}</span>
                        </p>
                      </div>
                      <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center text-white text-xs font-bold", b.color)}>
                        {p}%
                      </div>
                    </div>
                    <div className="mt-4 h-1.5 rounded-full overflow-hidden bg-[color:var(--color-surface-3)]">
                      <div className={cn("h-full rounded-full transition-all duration-700", b.color)} style={{ width: `${p}%`, transitionDelay: `${i * 60}ms` }} />
                    </div>
                    <Button variant="ghost" size="sm" className="mt-3 w-full justify-between text-[color:var(--color-g-blue)] hover:bg-[color:var(--color-g-blue-soft)] rounded-full">
                      Improve <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Card>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
