import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, FlaskConical, Minus, TrendingUp } from "lucide-react";
import { EmptyState, PageBody, PageHeader } from "@/components/console/primitives";
import { loadCategoryStory, PRICE_SIGNAL_META, type CategoryRow } from "@/lib/sales-story";

export const Route = createFileRoute("/_authenticated/sales/pricing")({
  head: () => ({
    meta: [
      { title: "Discount signals — Experience.com Console" },
      {
        name: "description",
        content:
          "Per-category pricing verdicts from margin, win rate, average deal and momentum: where to raise price and where price is losing deals.",
      },
      { property: "og:title", content: "Discount signals — Experience.com Console" },
      {
        property: "og:description",
        content: "Are we overcharging fabric stores and undercharging restaurants? The verdict per category, at a glance.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PricingSignals,
});

const cf = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const TONE: Record<string, { card: string; chip: string; big: string }> = {
  green: {
    card: "border-[#b7e1c4] bg-[#f2fbf5]",
    chip: "bg-[#0f5132] text-white",
    big: "text-[#0f5132]",
  },
  amber: {
    card: "border-[#f3dfa2] bg-[#fefaef]",
    chip: "bg-[#7a4f01] text-white",
    big: "text-[#7a4f01]",
  },
  neutral: {
    card: "border-[color:var(--color-hairline)] bg-[color:var(--color-surface)]",
    chip: "bg-[color:var(--color-surface-3)] text-[color:var(--color-ink-2)]",
    big: "text-[color:var(--color-ink)]",
  },
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-ink-3)]">
        {label}
      </p>
      <p className="mt-0.5 text-xl font-semibold leading-none tabular-nums text-[color:var(--color-ink)]">
        {value}
      </p>
      {hint ? <p className="mt-1 text-[10px] text-[color:var(--color-ink-3)]">{hint}</p> : null}
    </div>
  );
}

function SignalCard({ r }: { r: CategoryRow }) {
  const meta = PRICE_SIGNAL_META[r.priceSignal];
  const tone = TONE[meta.tone]!;
  const MomIcon = r.momentumPct === 0 ? Minus : r.momentumPct > 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <div className={`rounded-[22px] border p-6 ${tone.card}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold leading-tight text-[color:var(--color-ink)]">{r.label}</p>
          <p className="mt-1 flex items-center gap-1 text-xs text-[color:var(--color-ink-3)]">
            <MomIcon className="h-3.5 w-3.5" />
            {r.momentumPct > 0 ? "+" : ""}
            {r.momentumPct}% momentum
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide ${tone.chip}`}
        >
          {meta.verdict}
        </span>
      </div>

      <p className={`mt-4 text-[22px] font-semibold leading-snug tracking-tight ${tone.big}`}>
        {meta.action}
      </p>

      <div className="mt-6 grid grid-cols-2 gap-5 border-t border-[color:var(--color-hairline)] pt-4 sm:grid-cols-4">
        <Stat label="Avg margin" value={`${Math.round(r.avgMarginPct)}%`} hint="net of delivery cost" />
        <Stat label="Win rate" value={`${Math.round(r.winRate * 100)}%`} hint="closed / worked" />
        <Stat label="Avg deal" value={cf.format(r.avgDeal)} hint="per contract" />
        <Stat label="Revenue" value={cf.format(r.revenue)} hint="current period" />
      </div>

      {r.isDemo ? (
        <p className="mt-4 inline-flex items-center gap-1 rounded-full bg-[color:var(--color-g-purple-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#7b4ce0]">
          <FlaskConical className="h-3 w-3" /> demo
        </p>
      ) : null}
    </div>
  );
}

function PricingSignals() {
  const story = useQuery({ queryKey: ["sales-category-story"], queryFn: loadCategoryStory });
  const rows = [...(story.data?.rows ?? [])].sort((a, b) => {
    const rank = (s: CategoryRow) => (s.priceSignal === "healthy" ? 1 : 0);
    return rank(a) - rank(b) || b.momentumPct - a.momentumPct;
  });

  return (
    <PageBody>
      <PageHeader
        eyebrow="Growth Hub · CPQ"
        title="Discount signals"
        description="Margin against win rate and momentum, per category. Green means there is room to raise price; amber means price is costing us deals."
        actions={
          story.data?.allDemo ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-g-purple-soft)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#7b4ce0]">
              <FlaskConical className="h-3 w-3" /> Demo data
            </span>
          ) : null
        }
      />

      <p className="mb-6 flex items-center gap-2 text-xs text-[color:var(--color-ink-3)]">
        <TrendingUp className="h-4 w-4" />
        Underpriced = high demand and win rate on a thin margin. Overpriced = fat margin with low win rate and
        falling momentum.
      </p>

      {story.isLoading ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[300px] animate-pulse rounded-[22px] bg-[color:var(--color-surface-2)]" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No pricing signals yet"
          description="Pricing verdicts come from exp_sales_category_stats.price_signal."
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {rows.map((r) => (
            <SignalCard key={r.groupKey} r={r} />
          ))}
        </div>
      )}
    </PageBody>
  );
}
