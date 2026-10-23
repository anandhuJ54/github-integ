import { supabase } from "@/integrations/supabase/client";

/* ─────────────────────────────────────────────────────────────
   Seller desk — the lowest level of Growth Hub.
   Everything here is computed from live rows for ONE seller.
   ───────────────────────────────────────────────────────────── */

export type DeskWindow = 7 | 30 | 90 | 365;

export const DESK_WINDOWS: { value: DeskWindow; label: string }[] = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 365, label: "1 year" },
];

export type DeskRep = {
  id: string;
  name: string;
  role: string | null;
  group_key: string | null;
  title: string | null;
  team_name: string | null;
  email: string | null;
  phone: string | null;
  photo_url: string | null;
  sdrcloud_url: string | null;
  attribution_target: number | null;
  is_demo: boolean | null;
};

export type DeskTerritory = {
  id: string;
  label: string;
  tier: string | null;
  brand_count: number | null;
  office_count: number | null;
  agent_count: number | null;
};

type EventRow = { event_type: string | null; occurred_at: string | null; upgraded: boolean | null };
type DemoRow = {
  booked_at: string | null;
  attended: boolean | null;
  outcome: string | null;
  deal_value: number | null;
};
type RevRow = {
  source: string | null;
  amount: number | null;
  period_start: string | null;
  seller_id: string | null;
  attributed_seller_id: string | null;
};
type QuotaRow = { period_start: string | null; target: number | null; actual: number | null };

export type DeskData = {
  rep: DeskRep;
  territories: DeskTerritory[];
  bookTotal: number;
  bookClaimed: number;
  events: EventRow[];
  demos: DemoRow[];
  revenue: RevRow[];
  quarters: QuotaRow[];
};

export async function loadSellerDesk(repId: string): Promise<DeskData | null> {
  const repRes = await supabase
    .from("exp_sales_reps")
    .select(
      "id,name,role,group_key,title,team_name,email,phone,photo_url,sdrcloud_url,attribution_target,is_demo",
    )
    .eq("id", repId)
    .maybeSingle();
  if (!repRes.data) return null;
  const rep = repRes.data as DeskRep;

  const terrRes = await supabase
    .from("exp_territories")
    .select("id,label,tier,brand_count,office_count,agent_count")
    .eq("seller_id", repId)
    .order("label");
  const territories = (terrRes.data ?? []) as DeskTerritory[];
  const territoryIds = territories.map((t) => t.id);

  const [bookRes, claimedRes, evRes, demoRes, revRes, quotaRes] = await Promise.all([
    territoryIds.length
      ? supabase
          .from("professionals")
          .select("id", { count: "exact", head: true })
          .in("territory_id", territoryIds)
      : Promise.resolve({ count: 0 }),
    territoryIds.length
      ? supabase
          .from("professionals")
          .select("id", { count: "exact", head: true })
          .in("territory_id", territoryIds)
          .eq("claimed", true)
      : Promise.resolve({ count: 0 }),
    supabase
      .from("exp_claim_events")
      .select("event_type,occurred_at,upgraded")
      .eq("seller_id", repId),
    supabase
      .from("exp_sales_demos")
      .select("booked_at,attended,outcome,deal_value")
      .eq("seller_id", repId),
    supabase
      .from("exp_revenue_components")
      .select("source,amount,period_start,seller_id,attributed_seller_id")
      .or(`seller_id.eq.${repId},attributed_seller_id.eq.${repId}`),
    supabase
      .from("exp_sales_quotas")
      .select("period_start,target,actual")
      .eq("rep_id", repId)
      .eq("period_type", "quarter")
      .order("period_start"),
  ]);

  return {
    rep,
    territories,
    bookTotal: bookRes.count ?? 0,
    bookClaimed: claimedRes.count ?? 0,
    events: (evRes.data ?? []) as EventRow[],
    demos: (demoRes.data ?? []) as DemoRow[],
    revenue: (revRes.data ?? []) as RevRow[],
    quarters: (quotaRes.data ?? []) as QuotaRow[],
  };
}

/** New profiles added to the book inside the window (live count query). */
export async function countNewProfiles(territoryIds: string[], days: DeskWindow) {
  if (!territoryIds.length) return 0;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const res = await supabase
    .from("professionals")
    .select("id", { count: "exact", head: true })
    .in("territory_id", territoryIds)
    .gte("created_at", since);
  return res.count ?? 0;
}

/* ─────────── Derived metrics ─────────── */

const isAfter = (iso: string | null, sinceMs: number) =>
  !!iso && new Date(iso).getTime() >= sinceMs;

export type ProfileCard = {
  total: number;
  newInWindow: number;
  claimed: number;
  atc: number;
  unclaimed: number;
};

export function profileCard(d: DeskData, days: DeskWindow, newInWindow: number): ProfileCard {
  const since = Date.now() - days * 86400000;
  return {
    total: d.bookTotal,
    newInWindow,
    claimed: d.events.filter((e) => e.event_type === "claimed" && isAfter(e.occurred_at, since))
      .length,
    atc: d.events.filter((e) => e.event_type === "attempted" && isAfter(e.occurred_at, since))
      .length,
    unclaimed: Math.max(0, d.bookTotal - d.bookClaimed),
  };
}

export type DemoCard = {
  booked: number;
  attended: number;
  attendedPct: number | null;
  upgrades: number;
  upgradePct: number | null;
};

export function demoCard(d: DeskData, days: DeskWindow): DemoCard {
  const since = Date.now() - days * 86400000;
  const rows = d.demos.filter((x) => isAfter(x.booked_at, since));
  const booked = rows.length;
  const attended = rows.filter((x) => x.attended).length;
  const upgrades = rows.filter((x) => x.outcome === "won").length;
  return {
    booked,
    attended,
    attendedPct: booked ? (attended / booked) * 100 : null,
    upgrades,
    upgradePct: attended ? (upgrades / attended) * 100 : null,
  };
}

const monthOf = (iso: string | null) => (iso ?? "").slice(0, 7);
const quarterOf = (iso: string | null) => {
  if (!iso) return "";
  const m = Number(iso.slice(5, 7));
  return `${iso.slice(0, 4)}-Q${Math.floor((m - 1) / 3) + 1}`;
};

export type RevenueCard = {
  month: number;
  quarter: number;
  window: number;
  avgUpgradePrice: number | null;
  upgradeRows: number;
};

/** Her own upgrade revenue: seller_id rows, excluding contracted attribution credit. */
export function upgradeRevenueRows(d: DeskData) {
  return d.revenue.filter(
    (r) => r.seller_id === d.rep.id && (r.source ?? "") !== "contracted",
  );
}

export function revenueCard(d: DeskData, days: DeskWindow, now = new Date()): RevenueCard {
  const rows = upgradeRevenueRows(d);
  const since = Date.now() - days * 86400000;
  const nowIso = now.toISOString();
  const sum = (xs: typeof rows) => xs.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  const inWindow = rows.filter(
    (r) => !!r.period_start && new Date(r.period_start).getTime() >= since,
  );
  return {
    month: sum(rows.filter((r) => monthOf(r.period_start) === monthOf(nowIso))),
    quarter: sum(rows.filter((r) => quarterOf(r.period_start) === quarterOf(nowIso))),
    window: sum(inWindow),
    avgUpgradePrice: rows.length ? sum(rows) / rows.length : null,
    upgradeRows: rows.length,
  };
}

/* ─────────── Bar 1 · quota achievement ─────────── */

export type QuarterSegment = {
  key: string;
  label: string;
  target: number;
  actual: number;
  pct: number | null;
  tone: "green" | "yellow" | "red" | "empty";
  completed: boolean;
};

export function quotaBar(d: DeskData, now = new Date()) {
  const nowQ = quarterOf(now.toISOString());
  const segments: QuarterSegment[] = d.quarters.map((q) => {
    const target = Number(q.target ?? 0);
    const actual = Number(q.actual ?? 0);
    const pct = target > 0 ? (actual / target) * 100 : null;
    const key = quarterOf(q.period_start);
    const completed = key < nowQ;
    let tone: QuarterSegment["tone"] = "empty";
    if (pct != null) tone = pct >= 100 ? "green" : pct >= 65 ? "yellow" : "red";
    return { key, label: key.slice(5), target, actual, pct, tone, completed };
  });

  // Two consecutive COMPLETED quarters below 65%.
  const completed = segments.filter((s) => s.completed);
  let warning: string | null = null;
  for (let i = 1; i < completed.length; i += 1) {
    const a = completed[i - 1];
    const b = completed[i];
    if (a.tone === "red" && b.tone === "red") {
      warning = `Missed quota 2 quarters in a row — ${a.label} & ${b.label}`;
    }
  }

  const ytdTarget = segments.reduce((s, q) => s + q.target, 0);
  const ytdActual = segments.reduce((s, q) => s + q.actual, 0);

  return { segments, warning, ytdTarget, ytdActual };
}

/* ─────────── Bar 2 · contract attribution ─────────── */

export function attributionBar(d: DeskData) {
  const actual = d.revenue
    .filter((r) => r.attributed_seller_id === d.rep.id)
    .reduce((s, r) => s + Number(r.amount ?? 0), 0);
  const target = Number(d.rep.attribution_target ?? 0);
  return { actual, target, pct: target > 0 ? (actual / target) * 100 : null };
}
