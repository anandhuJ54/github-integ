import { api } from "@v3/state/api/server-fn";
import { SELLER_ROLES, type SellerRole } from "@v3/sales/utils/sales";
import {
  computeStatus,
  currentMonthInfo,
  ROLE_SHORT,
  type BoardStatus,
} from "@v3/sales/utils/seller-board";

/* ─────────── Types ─────────── */

export type FunnelKey =
  | "views"
  | "attempted_claims"
  | "claims"
  | "engaged_30d"
  | "logo_signals"
  | "demos_booked"
  | "demos_attended"
  | "closings"
  | "upgrades";

export const FUNNEL_STEPS: { key: FunnelKey; label: string; short: string }[] = [
  { key: "views", label: "Views", short: "Views" },
  { key: "attempted_claims", label: "Attempted claims", short: "Attempts" },
  { key: "claims", label: "Claims", short: "Claims" },
  { key: "engaged_30d", label: "30-day engaged", short: "Engaged" },
  { key: "logo_signals", label: "Logo signals", short: "Logo sig." },
  { key: "demos_booked", label: "Demos booked", short: "Booked" },
  { key: "demos_attended", label: "Demos attended", short: "Attended" },
  { key: "closings", label: "Closings", short: "Closings" },
  { key: "upgrades", label: "Upgrades", short: "Upgrades" },
];

export type RosterRow = {
  repId: string;
  name: string;
  role: string;
  roleLabel: string;
  roleShort: string;
  groupKey: string;
  categoryLabel: string;
  isDemo: boolean;

  status: BoardStatus;
  pct: number | null;
  target: number;
  actual: number;
  quotaTotal: number;
  hitStreak: number;
  missStreak: number;
  daysLeft: number;

  funnel: Record<FunnelKey, number>;
  profilesAssigned: number;
  logosAssigned: number;
  revenue: number;
  conversion: number | null;
  activityVolume: number;

  /** One-line human verdict. */
  why: string;
  isStar: boolean;
};

export type CategoryRow = {
  groupKey: string;
  label: string;
  momentumPct: number;
  avgMarginPct: number;
  winRate: number;
  avgDeal: number;
  priceSignal: "underpriced" | "overpriced" | "healthy";
  isDemo: boolean;
  revenue: number;
  activityVolume: number;
  sellers: number;
  logos: number;
  closings: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

/* ─────────── Helpers ─────────── */

function roleLabel(role: string): string {
  const direct = SELLER_ROLES[role as SellerRole]?.label;
  if (direct) return direct;
  const map: Record<string, string> = {
    SRE: "Search Rank Expert",
    SMB: "Small-Business Seller",
    MM: "Mid-Market Seller",
    ENT: "Enterprise Seller",
  };
  return map[role.toUpperCase()] ?? role;
}

function roleShort(role: string): string {
  return ROLE_SHORT[role] ?? role.toUpperCase();
}

function prettyGroup(key: string): string {
  return key
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function verdict(r: {
  pct: number | null;
  missStreak: number;
  hitStreak: number;
  conversion: number | null;
  activityVolume: number;
  medianActivity: number;
  medianConversion: number | null;
}): string {
  if (r.missStreak >= 2) return `${r.missStreak} months missed — intervene now`;
  if (r.missStreak === 1) return "Missed last month — needs a plan this week";
  if (
    r.activityVolume > r.medianActivity &&
    r.conversion !== null &&
    r.medianConversion !== null &&
    r.conversion < r.medianConversion
  )
    return "Activity high, conversion low — coach the demo";
  if (r.activityVolume < r.medianActivity * 0.6) return "Activity below the pack — top of funnel is thin";
  if ((r.pct ?? 0) >= 150) return "Blowing out quota — study and clone this play";
  if (r.hitStreak >= 3) return `${r.hitStreak} months hit in a row — promote`;
  if (r.hitStreak >= 1) return "Hit last month, on pace";
  return "No completed months yet";
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : ((s[mid - 1]! + s[mid]!) / 2);
}

/* ─────────── Roster ─────────── */

export async function loadRoster(now = new Date()): Promise<{
  rows: RosterRow[];
  groups: { key: string; label: string }[];
  roles: string[];
  allDemo: boolean;
  period: ReturnType<typeof currentMonthInfo>;
}> {
  const period = currentMonthInfo(now);

  // FastAPI: GET /sales/boards/roster (surface-api/sales/routers/boards_data.py)
  const res = await api.get<{
    reps: { id: string; name: string; role: string; group_key: string | null; is_demo: boolean | null }[];
    metrics: Raw[];
    quotas: {
      rep_id: string;
      period_type: string;
      period_start: string;
      target: number | null;
      actual: number | null;
      is_demo: boolean | null;
    }[];
    stats: { group_key: string; label: string | null }[];
  }>("/sales/boards/roster");

  const reps = res.reps ?? [];
  const metrics = res.metrics ?? [];
  const quotas = res.quotas ?? [];
  const labels = new Map((res.stats ?? []).map((s) => [s.group_key as string, s.label as string]));

  const base = reps.map((rep) => {
    const m = metrics.find((x) => x.rep_id === rep.id);
    const mine = quotas
      .filter((q) => q.rep_id === rep.id)
      .map((q) => ({ ...q, period_start: q.period_start ?? "" }))
      .sort((a, b) => (a.period_start < b.period_start ? 1 : -1));

    const current = mine.find((q) => q.period_start === period.start);
    const completed = mine.filter((q) => q.period_start < period.start);
    const history = completed.map((q) => {
      const target = Number(q.target ?? 0);
      const actual = Number(q.actual ?? 0);
      return { hit: target > 0 && actual >= target };
    });

    let hitStreak = 0;
    for (const h of history) {
      if (h.hit) hitStreak += 1;
      else break;
    }
    let missStreak = 0;
    for (const h of history) {
      if (!h.hit) missStreak += 1;
      else break;
    }

    const target = Number(current?.target ?? 0);
    const actual = Number(current?.actual ?? 0);
    const pct = target > 0 ? (actual / target) * 100 : null;
    const projected =
      period.daysElapsed > 0 ? (actual / period.daysElapsed) * period.daysInPeriod : actual;
    const onPace = target === 0 ? true : projected >= target;

    const funnel: Record<FunnelKey, number> = {
      views: Number(m?.views ?? 0),
      attempted_claims: Number(m?.attempted_claims ?? 0),
      claims: Number(m?.claims ?? 0),
      engaged_30d: Number(m?.engaged_30d ?? 0),
      logo_signals: Number(m?.logo_signals ?? 0),
      demos_booked: Number(m?.demos_booked ?? 0),
      demos_attended: Number(m?.demos_attended ?? 0),
      closings: Number(m?.closings ?? 0),
      upgrades: Number(m?.upgrades ?? 0),
    };
    const activityVolume =
      funnel.views + funnel.attempted_claims + funnel.claims + funnel.engaged_30d + funnel.demos_booked;
    const conversion =
      funnel.demos_attended > 0 ? (funnel.closings / funnel.demos_attended) * 100 : null;

    return {
      repId: rep.id,
      name: rep.name,
      role: rep.role,
      roleLabel: roleLabel(rep.role),
      roleShort: roleShort(rep.role),
      groupKey: rep.group_key ?? (m?.group_key as string) ?? "unassigned",
      categoryLabel:
        labels.get(rep.group_key ?? "") ?? prettyGroup(rep.group_key ?? "Unassigned"),
      isDemo: !!rep.is_demo || !!current?.is_demo || !!m?.is_demo,
      status: computeStatus({ hitStreak, missStreak, hasHistory: history.length > 0, onPace }),
      pct,
      target,
      actual,
      quotaTotal: mine.reduce((s, q) => s + Number(q.target ?? 0), 0),
      hitStreak,
      missStreak,
      daysLeft: period.daysLeft,
      funnel,
      profilesAssigned: Number(m?.profiles_assigned ?? 0),
      logosAssigned: Number(m?.logos_assigned ?? 0),
      revenue: Number(m?.revenue ?? 0),
      conversion,
      activityVolume,
    };
  });

  const medianActivity = median(base.map((b) => b.activityVolume));
  const conversions = base.map((b) => b.conversion).filter((c): c is number => c !== null);
  const medianConversion = conversions.length ? median(conversions) : null;

  const rows: RosterRow[] = base.map((b) => ({
    ...b,
    isStar: (b.pct ?? 0) >= 150,
    why: verdict({ ...b, medianActivity, medianConversion }),
  }));

  return {
    rows,
    groups: [...new Map(rows.map((r) => [r.groupKey, r.categoryLabel])).entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    roles: [...new Set(reps.map((r) => r.role).filter(Boolean))] as string[],
    allDemo: rows.length > 0 && rows.every((r) => r.isDemo),
    period,
  };
}

/* ─────────── Categories ─────────── */

export async function loadCategoryStory(): Promise<{ rows: CategoryRow[]; allDemo: boolean }> {
  // FastAPI: GET /sales/boards/category-story (surface-api/sales/routers/boards_data.py)
  const res = await api.get<{ stats: Raw[]; metrics: Raw[]; reps: { id: string; group_key: string | null }[] }>(
    "/sales/boards/category-story",
  );

  const stats = res.stats ?? [];
  const metrics = res.metrics ?? [];
  const reps = res.reps ?? [];

  const rows: CategoryRow[] = stats.map((s) => {
    const mine = metrics.filter((m) => m.group_key === s.group_key);
    const sum = (pick: (m: (typeof metrics)[number]) => number) =>
      mine.reduce((acc, m) => acc + pick(m), 0);
    return {
      groupKey: s.group_key as string,
      label: (s.label as string) ?? prettyGroup(s.group_key as string),
      momentumPct: Number(s.momentum_pct ?? 0),
      avgMarginPct: Number(s.avg_margin_pct ?? 0),
      winRate: Number(s.win_rate ?? 0),
      avgDeal: Number(s.avg_deal ?? 0),
      priceSignal: (s.price_signal as CategoryRow["priceSignal"]) ?? "healthy",
      isDemo: !!s.is_demo,
      revenue: sum((m) => Number(m.revenue ?? 0)),
      activityVolume: sum(
        (m) =>
          Number(m.views ?? 0) +
          Number(m.attempted_claims ?? 0) +
          Number(m.claims ?? 0) +
          Number(m.engaged_30d ?? 0) +
          Number(m.demos_booked ?? 0),
      ),
      closings: sum((m) => Number(m.closings ?? 0)),
      logos: sum((m) => Number(m.logos_assigned ?? 0)),
      sellers: reps.filter((r) => r.group_key === s.group_key).length,
    };
  });

  rows.sort((a, b) => b.momentumPct - a.momentumPct);
  return { rows, allDemo: rows.length > 0 && rows.every((r) => r.isDemo) };
}

export const PRICE_SIGNAL_META: Record<
  CategoryRow["priceSignal"],
  { verdict: string; action: string; tone: "green" | "amber" | "neutral" }
> = {
  underpriced: {
    verdict: "Underpriced",
    action: "Raise price — demand and win rate are high on a thin margin",
    tone: "green",
  },
  overpriced: {
    verdict: "Overpriced",
    action: "Price is losing deals — fat margin, low win rate and shrinking demand",
    tone: "amber",
  },
  healthy: {
    verdict: "Healthy",
    action: "Margin, win rate and momentum are in balance — hold",
    tone: "neutral",
  },
};
