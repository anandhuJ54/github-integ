import { ArrowUp, BarChart2, ChevronRight, Database, Layers, MessageSquare, Search, Star, User } from "lucide-react";
import { useInspireCopy } from "./copy";

function Gauge() {
  const value = 630;
  const max = 850;
  const r = 70;
  const cx = 90;
  const cy = 84;
  const circumference = Math.PI * r;
  const progress = (value / max) * circumference;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 180 100" className="w-full max-w-[10rem]" role="img" aria-label="Search Rank Score 630 out of 850">
        <defs>
          <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#c0392b" />
            <stop offset="45%" stopColor="#f0a500" />
            <stop offset="100%" stopColor="#3faa4b" />
          </linearGradient>
        </defs>
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth="13"
          strokeLinecap="round"
        />
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="url(#gaugeGrad)"
          strokeWidth="13"
          strokeLinecap="round"
          strokeDasharray={`${progress} ${circumference}`}
        />
      </svg>
      <p className="-mt-7 text-2xl font-extrabold text-ink">630</p>
      <p className="text-[0.7rem] font-medium text-ink/70">Search Rank Score</p>
      <div className="mt-1 flex w-full max-w-[10rem] items-center justify-between text-[0.65rem] text-ink/50">
        <span>0</span>
        <span className="inline-flex items-center gap-0.5 font-semibold text-brand-green">
          <ArrowUp className="h-3 w-3" aria-hidden="true" />
          +10
        </span>
        <span>850</span>
      </div>
    </div>
  );
}

const SIGNALS = [
  { label: "Review", icon: MessageSquare, w: 72 },
  { label: "Profile", icon: User, w: 58 },
  { label: "Connections", icon: Database, w: 64 },
  { label: "Listings", icon: Layers, w: 45 },
  { label: "Web Analytics", icon: BarChart2, w: 80 },
];

function SignalsMock() {
  return (
    <div className="grid w-full gap-2">
      {SIGNALS.map(({ label, icon: Icon, w }) => (
        <div key={label} className="rounded-lg border border-border bg-card px-2.5 py-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <Icon className="h-3.5 w-3.5 shrink-0 text-brand-blue" aria-hidden="true" />
            <span className="truncate text-[0.7rem] font-semibold text-ink">{label}</span>
          </span>
          <span className="mt-1.5 block h-1.5 rounded-full bg-muted">
            <span className="block h-1.5 rounded-full bg-brand-blue" style={{ width: `${w}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

function ReviewsMock() {
  return (
    <div className="w-full rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="font-insp-display text-base font-bold text-ink">Maria Grace</p>
        <span className="rounded-full bg-product-surface px-2.5 py-0.5 text-[0.6rem] font-bold text-brand-blue">
          Verified
        </span>
      </div>
      <p className="mt-0.5 text-[0.65rem] font-medium text-ink/55">Real Estate Agent</p>
      <div className="mt-3 flex items-center gap-1.5">
        <span className="text-sm font-bold text-ink">4.8</span>
        <span className="flex" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <Star key={i} className="h-3.5 w-3.5 fill-brand-amber text-brand-amber" />
          ))}
        </span>
        <span className="text-[0.65rem] text-ink/50">(463 reviews)</span>
      </div>
      <div className="mt-3 space-y-1.5" aria-hidden="true">
        <span className="block h-1.5 w-full rounded-full bg-product-surface" />
        <span className="block h-1.5 w-9/12 rounded-full bg-product-surface" />
      </div>
    </div>
  );
}

function AiMock() {
  return (
    <div className="w-full space-y-2.5">
      <div className="flex items-center gap-2.5 rounded-xl border border-border/70 bg-card p-2.5 shadow-sm">
        <Search className="ml-1 h-3.5 w-3.5 shrink-0 text-brand-blue" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-xs text-ink/70">best realtor in Atlanta</span>
        <span className="rounded-lg bg-charcoal px-2.5 py-1.5 text-[0.6rem] font-bold text-primary-foreground">
          Ask AI
        </span>
      </div>
      <div className="rounded-xl border border-border/70 bg-card p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-green" aria-hidden="true" />
          <span className="text-[0.55rem] font-bold uppercase tracking-[0.12em] text-ink/50">
            AI recommendation
          </span>
        </div>
        <p className="mt-1.5 text-[0.68rem] font-semibold leading-snug text-ink">
          Highly rated for your market based on 463 reviews.
        </p>
      </div>
    </div>
  );
}

const CARDS = [
  {
    eyebrow: "Search Rank Score®",
    headline: "See exactly where you stand.",
    body: "One score that shows how visible and trusted you are across Google and AI — and what to fix first.",
    visual: <Gauge />,
  },
  {
    eyebrow: "Reviews & Profiles",
    headline: "Trust that shows up everywhere.",
    body: "Reviews flow automatically to the profiles clients actually check before they call.",
    visual: <ReviewsMock />,
  },
  {
    eyebrow: "Signals",
    headline: "Every signal, connected.",
    body: "Profiles, reviews, listings, and web analytics feed one unified visibility system.",
    visual: <SignalsMock />,
  },
  {
    eyebrow: "AI Visibility",
    headline: "Be the answer AI gives.",
    body: "When clients ask AI who to hire, your reputation is what gets recommended.",
    visual: <AiMock />,
  },
];

export function Platform() {
  const copy = useInspireCopy();
  return (
    <section className="bg-product-surface py-10 sm:py-14">
      <div className="mx-auto w-full max-w-[1200px] px-8 sm:px-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="max-w-xl font-insp-display text-[1.625rem] font-bold leading-tight text-navy sm:text-[2.75rem]">
            One Platform. Total Visibility.{" "}
            <span className="text-ai-gradient">Real Growth.</span>
          </h2>
          <a
            href={copy.signupUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-sm font-medium text-brand-blue hover:underline"
          >
            Claim your profile
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>

        <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CARDS.map(({ eyebrow, headline, body, visual }) => (
            <div
              key={eyebrow}
              className="relative flex min-h-[380px] flex-col rounded-3xl bg-card p-6"
            >
              <p className="text-[0.8rem] font-semibold text-ink/60">{eyebrow}</p>
              <h3 className="mt-1.5 font-insp-display text-xl font-bold leading-snug text-ink">
                {headline}
              </h3>
              <p className="mt-2 text-[0.8rem] leading-relaxed text-ink/65">{body}</p>
              <div className="mt-auto flex items-end justify-center pt-6">{visual}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
