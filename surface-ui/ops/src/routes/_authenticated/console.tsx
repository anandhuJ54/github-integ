import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Bot,
  CircleDollarSign,
  Eye,
  FileSignature,
  Grid3x3,
  Hourglass,
  KeyRound,
  LineChart,
  Search,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Unplug,
  UserPlus,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { api } from "@v3/ui/lib/server-fn";
import { EmpLayout } from "@v3/ui/components/emp-layout";
import { PageBody, PageHeader, StatTile } from "@v3/ui/components/console/primitives";
import { Button } from "@v3/ui/components/ui/button";
import { cn } from "@v3/ui/lib/utils";

export const Route = createFileRoute("/_authenticated/console")({
  head: () => ({
    meta: [
      { title: "Console Home — Experience.com Super-Admin" },
      {
        name: "description",
        content:
          "Platform health, engagement, revenue, category intelligence, SEO and Nora analytics for the Experience.com super-admin console.",
      },
      { property: "og:title", content: "Console Home — Experience.com Super-Admin" },
      {
        property: "og:description",
        content: "Six metric groups covering platform health, revenue and Nora analytics.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HomePage,
});

/* ─────────── helpers ─────────── */

const nf = new Intl.NumberFormat("en-US");
const cf = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}
function startOfTodayIso() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function GroupHeading({ children, note }: { children: string; note?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-3">
      <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-[color:var(--color-ink-3)]">
        {children}
      </h2>
      {note ? (
        <span className="text-[11px] text-[color:var(--color-ink-3)]">{note}</span>
      ) : null}
    </div>
  );
}

/** Real prior-period comparison only. */
function Delta({ current, previous, unit }: { current: number; previous: number; unit: string }) {
  const diff = current - previous;
  const flat = diff === 0;
  const up = diff > 0;
  const Icon = flat ? ArrowRight : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        flat
          ? "text-[color:var(--color-ink-3)]"
          : up
            ? "text-[#1e8e3e]"
            : "text-[#c5221f]",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {flat ? "Flat" : `${up ? "+" : ""}${nf.format(diff)}`} vs prior {unit}
    </span>
  );
}

/** Same visual language as StatTile, but explicitly not a value. */
function InstrumentTile({
  label,
  note,
  icon,
}: {
  label: string;
  note: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-[20px] border border-dashed border-[color:var(--color-hairline)] bg-[color:var(--color-surface-2)] p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wider text-[color:var(--color-ink-3)]">
          {label}
        </p>
        {icon ? (
          <span className="grid h-8 w-8 place-items-center rounded-full bg-white text-[color:var(--color-ink-3)]">
            {icon}
          </span>
        ) : null}
      </div>
      <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-ink-3)]">
        <Unplug className="h-3 w-3" />
        Instrument to activate
      </p>
      <p className="mt-2 text-xs leading-relaxed text-[color:var(--color-ink-3)]">{note}</p>
    </div>
  );
}

/* ─────────── data ─────────── */

function useProfiles() {
  return useQuery({
    queryKey: ["home", "profiles"],
    queryFn: async () => {
      const d7 = isoDaysAgo(7);
      const d14 = isoDaysAgo(14);
      const today = startOfTodayIso();
      // the 14 counts (professionals + organizations), from /ops/console/profiles
      const c = await api.get<Record<string, number>>("/ops/console/profiles", {
        params: { d7, d14, today },
      });
      const [
        pros,
        orgs,
        prosNew,
        orgsNew,
        prosPrev,
        orgsPrev,
        prosClaimed,
        orgsClaimed,
        prosClaims7,
        orgsClaims7,
        prosClaimsPrev,
        orgsClaimsPrev,
        prosClaimsToday,
        orgsClaimsToday,
      ] = ["total", "new7", "prev7", "claimed", "claims7", "claimsPrev7", "claimsToday"].flatMap(
        (k) => [c[`pros_${k}`] ?? 0, c[`orgs_${k}`] ?? 0],
      );
      const total = pros + orgs;
      const claimed = prosClaimed + orgsClaimed;
      return {
        total,
        claimed,
        unclaimed: total - claimed,
        added7: prosNew + orgsNew,
        addedPrev7: prosPrev + orgsPrev,
        claims7: prosClaims7 + orgsClaims7,
        claimsPrev7: prosClaimsPrev + orgsClaimsPrev,
        claimsToday: prosClaimsToday + orgsClaimsToday,
      };
    },
  });
}

function useRevenue() {
  return useQuery({
    queryKey: ["home", "revenue"],
    queryFn: async () => {
      const data = await api.get<
        { id: string; status: string | null; mrr: number | null; end_date: string | null }[]
      >("/ops/console/revenue");
      const active = data.filter((r) => r.status === "active");
      const mrr = active.reduce((s, r) => s + Number(r.mrr ?? 0), 0);
      const horizon = new Date(Date.now() + 90 * 86_400_000);
      const expiring = active.filter(
        (r) => r.end_date && new Date(r.end_date) <= horizon && new Date(r.end_date) >= new Date(),
      ).length;
      return { activeContracts: active.length, mrr, arr: mrr * 12, expiring };
    },
  });
}

function useCategoryIntel() {
  return useQuery({
    queryKey: ["home", "categories"],
    queryFn: async () => {
      const today = startOfTodayIso();
      const { active, total, etlRunning, prosToday, orgsToday } = await api.get<{
        active: number;
        total: number;
        etlRunning: number;
        prosToday: number;
        orgsToday: number;
      }>("/ops/console/categories", { params: { today } });
      return {
        active,
        notActive: total - active,
        etlRunning,
        profilesToday: prosToday + orgsToday,
      };
    },
    refetchInterval: 60_000,
  });
}

function useNoraEvents() {
  return useQuery({
    queryKey: ["home", "nora-events"],
    queryFn: async () => {
      const d30 = isoDaysAgo(30);
      const d60 = isoDaysAgo(60);
      const rows = await api.get<{ event_type: string | null; occurred_at: string | null }[]>(
        "/ops/console/nora-events",
        { params: { since: d60 } },
      );
      const inWindow = (r: { occurred_at: string | null }, from: string, to?: string) =>
        r.occurred_at != null && r.occurred_at >= from && (!to || r.occurred_at < to);
      const tally = (type: string, from: string, to?: string) =>
        rows.filter((r) => r.event_type === type && inWindow(r, from, to)).length;
      const upgrades = tally("upgrade", d30);
      const downgrades = tally("downgrade", d30);
      return {
        upgrades,
        downgrades,
        net: upgrades - downgrades,
        upgradesPrev: tally("upgrade", d60, d30),
        downgradesPrev: tally("downgrade", d60, d30),
      };
    },
  });
}

/* ─────────── page ─────────── */

function HomePage() {
  const profiles = useProfiles();
  const revenue = useRevenue();
  const cats = useCategoryIntel();
  const nora = useNoraEvents();

  return (
    <EmpLayout>
      <PageBody>
        <PageHeader
          eyebrow="Home"
          title="Super-Admin Console"
          description="Six metric groups across the Experience.com and Nora platform. Tiles without a wired source are labeled so you know exactly what needs instrumenting."
          actions={
            <Button asChild variant="outline" className="rounded-[10px]">
              <Link to="/categories">Open Categories</Link>
            </Button>
          }
        />

        {/* GROUP 1 */}
        <section className="space-y-4">
          <GroupHeading note="Live">PLATFORM HEALTH</GroupHeading>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatTile
              label="Total profiles"
              tone="blue"
              icon={<Users className="h-4 w-4" />}
              loading={profiles.isLoading}
              value={nf.format(profiles.data?.total ?? 0)}
              hint="Professionals + organizations"
            />
            <StatTile
              label="Profiles added (7d)"
              tone="purple"
              icon={<UserPlus className="h-4 w-4" />}
              loading={profiles.isLoading}
              value={nf.format(profiles.data?.added7 ?? 0)}
              hint="By created_at"
            />
            <StatTile
              label="Claimed"
              tone="green"
              icon={<BadgeCheck className="h-4 w-4" />}
              loading={profiles.isLoading}
              value={nf.format(profiles.data?.claimed ?? 0)}
              hint={`${nf.format(profiles.data?.unclaimed ?? 0)} unclaimed`}
            />
            <StatTile
              label="New claims (7d)"
              tone="green"
              icon={<KeyRound className="h-4 w-4" />}
              loading={profiles.isLoading}
              value={nf.format(profiles.data?.claims7 ?? 0)}
              hint="By claimed_at"
            />
            <StatTile
              label="Claims today"
              tone="yellow"
              icon={<KeyRound className="h-4 w-4" />}
              loading={profiles.isLoading}
              value={nf.format(profiles.data?.claimsToday ?? 0)}
              hint="Since 00:00 UTC"
            />
            <div className="rounded-[20px] border border-[color:var(--color-hairline)] bg-card p-5 shadow-[var(--shadow-xs)]">
              <p className="text-xs font-medium uppercase tracking-wider text-[color:var(--color-ink-3)]">
                Week over week
              </p>
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm text-ink">
                  <span>Profiles added</span>
                  <Delta
                    current={profiles.data?.added7 ?? 0}
                    previous={profiles.data?.addedPrev7 ?? 0}
                    unit="7d"
                  />
                </div>
                <div className="flex items-center justify-between gap-3 text-sm text-ink">
                  <span>New claims</span>
                  <Delta
                    current={profiles.data?.claims7 ?? 0}
                    previous={profiles.data?.claimsPrev7 ?? 0}
                    unit="7d"
                  />
                </div>
              </div>
              <p className="mt-3 text-xs text-[color:var(--color-ink-3)]">
                Historical claims before claimed_at tracking are null and excluded.
              </p>
            </div>
          </div>
        </section>

        {/* GROUP 2 */}
        <section className="mt-10 space-y-4">
          <GroupHeading note="Needs page-analytics event stream + auth session tracking">
            ENGAGEMENT METRICS
          </GroupHeading>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <InstrumentTile
              label="Total impressions"
              icon={<Eye className="h-4 w-4" />}
              note="Needs a page-view/impression event stream across all Experience.com pages, with period-over-period history for growth."
            />
            <InstrumentTile
              label="Total views"
              icon={<Eye className="h-4 w-4" />}
              note="Needs the same analytics event stream, split by profile/page view type."
            />
            <InstrumentTile
              label="Logins (30d)"
              icon={<KeyRound className="h-4 w-4" />}
              note="Needs an auth sign-in event log; Supabase auth sessions are not mirrored into a queryable table yet."
            />
            <InstrumentTile
              label="Current login sessions"
              icon={<Users className="h-4 w-4" />}
              note="Needs live session tracking (heartbeat or session table) written on sign-in and refresh."
            />
            <InstrumentTile
              label="Unique logins (30d)"
              icon={<Users className="h-4 w-4" />}
              note="Needs the auth sign-in log with distinct user aggregation over the trailing 30 days."
            />
          </div>
        </section>

        {/* GROUP 3 */}
        <section className="mt-10 space-y-4">
          <GroupHeading note="Contracted revenue live · OS pending Stripe">
            REVENUE METRICS
          </GroupHeading>

          <p className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-ink-3)]">
            Platform / OS (self-serve)
          </p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <InstrumentTile
              label="Total OS revenue"
              icon={<CircleDollarSign className="h-4 w-4" />}
              note="Needs Stripe / self-serve billing events ingested into a payments table."
            />
            <InstrumentTile
              label="Today's new revenue"
              icon={<TrendingUp className="h-4 w-4" />}
              note="Needs Stripe charge/subscription-created webhooks with a daily rollup."
            />
            <InstrumentTile
              label="Total upgrades (by product)"
              icon={<Sparkles className="h-4 w-4" />}
              note="Needs self-serve upgrade billing events per product key; activity events record upgrades but carry no revenue amount."
            />
          </div>

          <p className="mt-6 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-ink-3)]">
            Contracted (enterprise)
          </p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Enterprise MRR"
              tone="green"
              icon={<CircleDollarSign className="h-4 w-4" />}
              loading={revenue.isLoading}
              value={cf.format(revenue.data?.mrr ?? 0)}
              hint="Sum of active contract MRR"
            />
            <StatTile
              label="Contracted ARR"
              tone="green"
              icon={<LineChart className="h-4 w-4" />}
              loading={revenue.isLoading}
              value={cf.format(revenue.data?.arr ?? 0)}
              hint="Active MRR × 12"
            />
            <StatTile
              label="Active contracts"
              tone="blue"
              icon={<FileSignature className="h-4 w-4" />}
              loading={revenue.isLoading}
              value={nf.format(revenue.data?.activeContracts ?? 0)}
              hint="exp_contracts · status active"
            />
            <StatTile
              label="Expiring in 90 days"
              tone="yellow"
              icon={<Hourglass className="h-4 w-4" />}
              loading={revenue.isLoading}
              value={nf.format(revenue.data?.expiring ?? 0)}
              hint="Active contracts by end_date"
            />
          </div>

          <div className="mt-4 rounded-[20px] border border-[color:var(--color-hairline)] bg-card p-5 shadow-[var(--shadow-xs)]">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-[color:var(--color-ink-3)]">
                  Combined ARR / MRR
                </p>
                <p className="mt-2 text-[28px] font-semibold leading-none tracking-tight text-ink">
                  {cf.format(revenue.data?.arr ?? 0)}{" "}
                  <span className="text-sm font-medium text-[color:var(--color-ink-2)]">
                    ARR · {cf.format(revenue.data?.mrr ?? 0)} MRR
                  </span>
                </p>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--color-surface-3)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-ink-3)]">
                <Unplug className="h-3 w-3" />
                OS pending Stripe
              </span>
            </div>
          </div>
        </section>

        {/* GROUP 4 */}
        <section className="mt-10 space-y-4">
          <GroupHeading note="Live">CATEGORY INTELLIGENCE</GroupHeading>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Categories active"
              tone="blue"
              icon={<Grid3x3 className="h-4 w-4" />}
              loading={cats.isLoading}
              value={nf.format(cats.data?.active ?? 0)}
              hint="gbp_categories · status active"
            />
            <StatTile
              label="Categories not active"
              tone="neutral"
              icon={<Grid3x3 className="h-4 w-4" />}
              loading={cats.isLoading}
              value={nf.format(cats.data?.notActive ?? 0)}
              hint="Any non-active status"
            />
            <StatTile
              label="ETLs running"
              tone="purple"
              icon={<Bot className="h-4 w-4" />}
              loading={cats.isLoading}
              value={nf.format(cats.data?.etlRunning ?? 0)}
              hint="disco_jobs queued / awaiting AI / running"
            />
            <StatTile
              label="Profiles added today"
              tone="yellow"
              icon={<UserPlus className="h-4 w-4" />}
              loading={cats.isLoading}
              value={nf.format(cats.data?.profilesToday ?? 0)}
              hint="Live · refreshes each minute"
            />
          </div>
        </section>

        {/* GROUP 5 */}
        <section className="mt-10 space-y-4">
          <GroupHeading note="Needs LLM-visibility + SERP scanners and a history store">
            EXPERIENCE.COM SEO
          </GroupHeading>
          <div className="grid gap-4 sm:grid-cols-2">
            <InstrumentTile
              label="LLM monitor"
              icon={<Bot className="h-4 w-4" />}
              note="Needs a daily scanner that asks 10 primary keywords across all major LLMs and stores each answer/citation snapshot over time."
            />
            <InstrumentTile
              label="SERP / organic rank"
              icon={<Search className="h-4 w-4" />}
              note="Needs a SERP rank tracker for the top 10 keywords (e.g. Best Reputation Management Platform, Listings Management, Reviews) with daily rank history."
            />
          </div>
        </section>

        {/* GROUP 6 */}
        <section className="mt-10 space-y-4">
          <GroupHeading note="Conversions live from activity events · sessions and tokens need the Nora event log">
            NORA ANALYTICS
          </GroupHeading>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatTile
              label="Upgrades (30d)"
              tone="green"
              icon={<TrendingUp className="h-4 w-4" />}
              loading={nora.isLoading}
              value={nf.format(nora.data?.upgrades ?? 0)}
              hint="exp_activity_events · upgrade"
            />
            <StatTile
              label="Downgrades (30d)"
              tone="red"
              icon={<TrendingDown className="h-4 w-4" />}
              loading={nora.isLoading}
              value={nf.format(nora.data?.downgrades ?? 0)}
              hint="exp_activity_events · downgrade"
            />
            <StatTile
              label="Net conversions (30d)"
              tone="blue"
              icon={<LineChart className="h-4 w-4" />}
              loading={nora.isLoading}
              value={nf.format(nora.data?.net ?? 0)}
              hint="Upgrades minus downgrades"
            />
            <div className="rounded-[20px] border border-[color:var(--color-hairline)] bg-card p-5 shadow-[var(--shadow-xs)]">
              <p className="text-xs font-medium uppercase tracking-wider text-[color:var(--color-ink-3)]">
                30 days vs prior 30
              </p>
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm text-ink">
                  <span>Upgrades</span>
                  <Delta
                    current={nora.data?.upgrades ?? 0}
                    previous={nora.data?.upgradesPrev ?? 0}
                    unit="30d"
                  />
                </div>
                <div className="flex items-center justify-between gap-3 text-sm text-ink">
                  <span>Downgrades</span>
                  <Delta
                    current={nora.data?.downgrades ?? 0}
                    previous={nora.data?.downgradesPrev ?? 0}
                    unit="30d"
                  />
                </div>
              </div>
            </div>
            <InstrumentTile
              label="Sessions (24h / 7d / 30d)"
              icon={<Bot className="h-4 w-4" />}
              note="Needs a Nora conversation/session log; activity events record engagement but not session boundaries."
            />
            <InstrumentTile
              label="Total tokens used"
              icon={<Sparkles className="h-4 w-4" />}
              note="Needs the token ledger written per Nora request (prompt + completion tokens per account)."
            />
            <InstrumentTile
              label="Total improvement"
              icon={<TrendingUp className="h-4 w-4" />}
              note="Needs Nora-attributed node/element additions plus before/after score deltas recorded per session."
            />
            <InstrumentTile
              label="Regressions"
              icon={<TrendingDown className="h-4 w-4" />}
              note="Needs removal events and score-decay tracking attributed to Nora sessions."
            />
            <InstrumentTile
              label="Conversations → conversion"
              icon={<Bot className="h-4 w-4" />}
              note="Needs conversation counts from the Nora event log to pair with the live upgrade/downgrade counts above."
            />
          </div>
        </section>
      </PageBody>
    </EmpLayout>
  );
}
