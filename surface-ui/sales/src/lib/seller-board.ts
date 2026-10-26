import { api } from "@v3/ui/lib/server-fn";
import { SELLER_ROLES, type SellerRole } from "@v3/sales/lib/sales";

/* ─────────── Types ─────────── */

export type BoardStatus = "dark_green" | "green" | "yellow" | "red" | "dark_red" | "unknown";

export type PipelineStage = "prospect" | "qualified" | "proposal" | "won" | "lost";
export const OPEN_STAGES: PipelineStage[] = ["prospect", "qualified", "proposal"];

export type SellerCard = {
  repId: string;
  name: string;
  role: string;
  roleLabel: string;
  roleShort: string;
  groupKey: string;
  isDemo: boolean;

  /** Current (in-progress) month */
  target: number;
  actual: number;
  pct: number | null;
  daysLeft: number;
  daysElapsed: number;
  daysInPeriod: number;
  /** Pace-projected end-of-month total */
  projected: number;

  /** History (completed months, newest first) */
  history: { period: string; target: number; actual: number; hit: boolean }[];
  hitStreak: number;
  missStreak: number;

  /** Pipeline */
  demosTotal: number;
  demosAttended: number;
  upgrades: number;
  conversion: number | null;
  pipelineOpen: number;
  byStage: { stage: PipelineStage; count: number; value: number }[];
  quotaTotal: number;

  status: BoardStatus;
};

export const ROLE_SHORT: Record<string, string> = {
  srx: "SRE",
  smb: "SMB",
  mid_market: "MM",
  enterprise: "ENT",
};

export const STATUS_META: Record<
  BoardStatus,
  { label: string; note: string; order: number }
> = {
  dark_red: { label: "Dark red", note: "Missed the last 2 completed months — fire", order: 0 },
  red: { label: "Red", note: "Missed the last completed month", order: 1 },
  yellow: { label: "Yellow", note: "Pace is short of the current month's target", order: 2 },
  dark_green: { label: "Dark green", note: "Hit quota 3+ completed months in a row — promote", order: 3 },
  green: { label: "Green", note: "Hit the last completed month (streak 1–2)", order: 4 },
  unknown: { label: "No history", note: "No completed monthly quota rows yet", order: 5 },
};

/* ─────────── Period helpers ─────────── */

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function currentMonthInfo(now = new Date()) {
  const start = monthKey(now);
  const daysInPeriod = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const daysElapsed = now.getUTCDate();
  return { start, daysInPeriod, daysElapsed, daysLeft: Math.max(0, daysInPeriod - daysElapsed) };
}

/* ─────────── Status rules ─────────── */

export function computeStatus(input: {
  hitStreak: number;
  missStreak: number;
  hasHistory: boolean;
  onPace: boolean;
}): BoardStatus {
  if (input.missStreak >= 2) return "dark_red";
  if (input.missStreak >= 1) return "red";
  if (!input.onPace) return "yellow";
  if (input.hitStreak >= 3) return "dark_green";
  if (input.hitStreak >= 1) return "green";
  return input.hasHistory ? "yellow" : "unknown";
}

/* ─────────── Loader ─────────── */

export async function loadSellerBoard(now = new Date()): Promise<{
  cards: SellerCard[];
  groups: string[];
  roles: string[];
  allDemo: boolean;
  period: ReturnType<typeof currentMonthInfo>;
}> {
  const period = currentMonthInfo(now);

  // FastAPI: GET /sales/boards/seller-board (surface-api/sales/routers/boards_data.py)
  const res = await api.get<{
    reps: { id: string; name: string; role: string; group_key: string; is_demo: boolean | null }[];
    quotas: {
      rep_id: string;
      period_type: string;
      period_start: string;
      target: number | null;
      actual: number | null;
      is_demo: boolean | null;
    }[];
    pipeline: { owner: string | null; stage: string; value: number | null; is_demo: boolean | null }[];
  }>("/sales/boards/seller-board");

  const reps = res.reps ?? [];
  const quotas = res.quotas ?? [];
  const pipeline = res.pipeline ?? [];

  const cards: SellerCard[] = reps.map((rep) => {
    const mine = quotas
      .filter((q) => q.rep_id === rep.id)
      .map((q) => ({ ...q, period_start: q.period_start ?? "" }))
      .sort((a, b) => (a.period_start < b.period_start ? 1 : -1));

    const current = mine.find((q) => q.period_start === period.start);
    const completed = mine.filter((q) => q.period_start < period.start);

    const history = completed.map((q) => {
      const target = Number(q.target ?? 0);
      const actual = Number(q.actual ?? 0);
      return { period: q.period_start, target, actual, hit: target > 0 && actual >= target };
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

    const opps = pipeline.filter((p) => p.owner === rep.id);
    const byStage = (["prospect", "qualified", "proposal", "won", "lost"] as PipelineStage[]).map(
      (stage) => {
        const rows = opps.filter((p) => p.stage === stage);
        return {
          stage,
          count: rows.length,
          value: rows.reduce((s, p) => s + Number(p.value ?? 0), 0),
        };
      },
    );
    const won = byStage.find((s) => s.stage === "won")?.count ?? 0;
    const demosTotal = opps.length;
    const demosAttended = byStage
      .filter((s) => s.stage !== "prospect")
      .reduce((s, r) => s + r.count, 0);
    const pipelineOpen = byStage
      .filter((s) => OPEN_STAGES.includes(s.stage))
      .reduce((s, r) => s + r.value, 0);

    return {
      repId: rep.id,
      name: rep.name,
      role: rep.role,
      roleLabel: SELLER_ROLES[rep.role as SellerRole]?.label ?? rep.role,
      roleShort: ROLE_SHORT[rep.role] ?? rep.role.toUpperCase(),
      groupKey: rep.group_key,
      isDemo: !!rep.is_demo || !!current?.is_demo,
      target,
      actual,
      pct,
      daysLeft: period.daysLeft,
      daysElapsed: period.daysElapsed,
      daysInPeriod: period.daysInPeriod,
      projected,
      history,
      hitStreak,
      missStreak,
      demosTotal,
      demosAttended,
      upgrades: won,
      conversion: demosTotal > 0 ? (won / demosTotal) * 100 : null,
      pipelineOpen,
      byStage,
      quotaTotal: mine.reduce((s, q) => s + Number(q.target ?? 0), 0),
      status: computeStatus({
        hitStreak,
        missStreak,
        hasHistory: history.length > 0,
        onPace,
      }),
    };
  });

  return {
    cards,
    groups: [...new Set(reps.map((r) => r.group_key).filter(Boolean))] as string[],
    roles: [...new Set(reps.map((r) => r.role).filter(Boolean))] as string[],
    allDemo:
      cards.length > 0 &&
      cards.every((c) => c.isDemo) &&
      pipeline.every((p) => p.is_demo !== false),
    period,
  };
}
