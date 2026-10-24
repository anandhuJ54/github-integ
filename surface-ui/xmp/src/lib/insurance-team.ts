import { api } from "@v3/ui/lib/server-fn";

/* ────────────────────────────────────────────────────────────
   Team Central — one sales team read live from the commercial
   tables only (reps, quotas, revenue components, territories,
   territory→brand links, organizations, expansion views).
   No graph / taxonomy / registry / scoring / compliance reads.
   ──────────────────────────────────────────────────────────── */

export type PeriodKey = "month" | "quarter" | "year";

export const PERIOD_LABEL: Record<PeriodKey, string> = {
  month: "This month",
  quarter: "This quarter",
  year: "This year",
};

export type Pace = "ahead" | "on_track" | "behind" | "unknown";

export type Member = {
  id: string;
  name: string;
  title: string | null;
  role: string;
  phone: string | null;
  photo_url: string | null;
  slack_channel: string | null;
  on_duty: boolean | null;
  is_demo: boolean | null;
  territories: { id: string; label: string; tier: string }[];
  logos: { org_id: string; name: string }[];
  professionals: number;
  offices: number;
  production: Record<PeriodKey, number | null>;
  quota: Record<PeriodKey, { target: number | null; actual: number | null; pct: number | null; pace: Pace }>;
};

export type LogoExpansion = {
  org_id: string;
  org_name: string;
  year: number;
  first_booking_at: string;
  baseline: number;
  ytd_revenue: number;
  new_revenue: number;
  expansion_revenue: number;
  expansion_pct: number | null;
};

export type MonthPoint = { month_start: string; month_revenue: number; cumulative_revenue: number };

export type TeamCentral = {
  groupKey: string;
  familyKey: string | null;
  label: string;
  members: Member[];
  logos: { org_id: string; name: string; tier: string; territory: string }[];
  territories: {
    id: string;
    label: string;
    tier: string;
    seller: string | null;
    inTeam: boolean;
    logos: number;
    offices: number;
    professionals: number;
  }[];
  totals: {
    logos: number;
    offices: number;
    professionals: number;
    territories: number;
  };
  production: Record<PeriodKey, number | null>;
  bySource: { source: string; amount: number }[];
  months: MonthPoint[];
  expansion: LogoExpansion[];
  expansionThisYear: LogoExpansion | null;
  periodBounds: Record<PeriodKey, { start: string; end: string; elapsed: number }>;
};

/* ─── period helpers ─── */

const iso = (d: Date) => d.toISOString().slice(0, 10);

function bounds(now: Date) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const qStart = Math.floor(m / 3) * 3;
  const mk = (a: Date, b: Date) => {
    const span = b.getTime() - a.getTime();
    const done = now.getTime() - a.getTime();
    return { start: iso(a), end: iso(b), elapsed: Math.min(1, Math.max(0.01, done / span)) };
  };
  return {
    month: mk(new Date(Date.UTC(y, m, 1)), new Date(Date.UTC(y, m + 1, 1))),
    quarter: mk(new Date(Date.UTC(y, qStart, 1)), new Date(Date.UTC(y, qStart + 3, 1))),
    year: mk(new Date(Date.UTC(y, 0, 1)), new Date(Date.UTC(y + 1, 0, 1))),
  };
}

export function paceOf(pct: number | null, elapsed: number): Pace {
  if (pct == null) return "unknown";
  const expected = elapsed * 100;
  if (expected <= 0) return "unknown";
  const ratio = pct / expected;
  if (ratio >= 1.05) return "ahead";
  if (ratio >= 0.9) return "on_track";
  return "behind";
}

export const PACE_META: Record<Pace, { label: string; chip: string; bar: string }> = {
  ahead: { label: "Ahead of pace", chip: "bg-[#e6f4ea] text-[#0f5132]", bar: "bg-[#1e8e3e]" },
  on_track: { label: "On track", chip: "bg-[#e8f0fe] text-[#174ea6]", bar: "bg-[color:var(--color-g-blue)]" },
  behind: { label: "Behind pace", chip: "bg-[#fce8e6] text-[#8c1d18]", bar: "bg-[#d93025]" },
  unknown: {
    label: "No quota on file",
    chip: "bg-[color:var(--color-surface-3)] text-[color:var(--color-ink-3)]",
    bar: "bg-[color:var(--color-ink-3)]",
  },
};

const num = (v: unknown) => (v == null ? 0 : Number(v));

/* ─── loader ─── */

export async function loadTeamCentral(groupKey: string, now = new Date()): Promise<TeamCentral> {
  const pb = bounds(now);

  // reps, territories, revenue components, quotas and category groups (server side, read-only)
  const base = await api.get<Record<"reps" | "territories" | "revenue" | "quotas" | "groups", any[]>>(
    `/xmp/team/${encodeURIComponent(groupKey)}`,
  );
  const repsQ = { data: base.reps };
  const terrQ = { data: base.territories };
  const revQ = { data: base.revenue };
  const quotaQ = { data: base.quotas };
  const groupQ = { data: base.groups };

  const allTerr = (terrQ.data ?? []) as any[];
  const familyKey: string | null =
    allTerr.find((t) => t.group_key === groupKey)?.group_key ??
    allTerr.find((t) => typeof t.group_key === "string" && t.group_key.startsWith(`${groupKey}_`))
      ?.group_key ??
    null;

  const terrs = familyKey ? allTerr.filter((t) => t.group_key === familyKey) : [];
  const terrIds = terrs.map((t) => t.id);

  // territory→brand links, the linked organizations, the expansion views and the territory
  // sellers' names (server side, read-only)
  const fam = await api.post<Record<"links" | "orgs" | "sellers" | "expansion" | "months", any[]>>(
    "/xmp/team/family",
    { family_key: familyKey, territory_ids: terrIds, year: now.getUTCFullYear() },
  );
  const linkQ = { data: fam.links };
  const expQ = { data: fam.expansion };
  const monthQ = { data: fam.months };

  const rawLinks = (linkQ.data ?? []) as any[];
  const orgQ = { data: fam.orgs };
  const orgName = new Map(((orgQ.data ?? []) as any[]).map((o) => [o.id as string, o.name as string]));

  const links = rawLinks.map((l) => ({
    territory_id: l.territory_id as string,
    org_id: l.org_id as string,
    name: orgName.get(l.org_id as string) ?? "Unnamed logo",
  }));

  const revenue = (revQ.data ?? []) as any[];
  const quotas = (quotaQ.data ?? []) as any[];

  const inPeriod = (d: string, p: PeriodKey) => d >= pb[p].start && d < pb[p].end;
  const sumPeriod = (rows: any[], p: PeriodKey): number | null => {
    const hits = rows.filter((r) => inPeriod(String(r.period_start), p));
    return hits.length ? hits.reduce((s, r) => s + num(r.amount), 0) : null;
  };

  const members: Member[] = ((repsQ.data ?? []) as any[]).map((r) => {
    const mine = terrs.filter((t) => t.seller_id === r.id);
    const mineIds = new Set(mine.map((t) => t.id));
    const myLogos = links.filter((l) => mineIds.has(l.territory_id));
    const rows = revenue.filter((x) => (x.attributed_seller_id ?? x.seller_id) === r.id);

    const quota = {} as Member["quota"];
    (["month", "quarter", "year"] as PeriodKey[]).forEach((p) => {
      const q = quotas.find((x) => x.rep_id === r.id && x.period_type === p && inPeriod(String(x.period_start), p));
      const target = q ? num(q.target) : null;
      const actual = q && q.actual != null ? num(q.actual) : sumPeriod(rows, p);
      const pct = target && target > 0 && actual != null ? (actual / target) * 100 : null;
      quota[p] = { target, actual, pct, pace: paceOf(pct, pb[p].elapsed) };
    });

    return {
      id: r.id,
      name: r.name,
      title: r.title ?? null,
      role: r.role,
      phone: r.phone ?? null,
      photo_url: r.photo_url ?? null,
      slack_channel: r.slack_channel ?? null,
      on_duty: r.on_duty ?? null,
      is_demo: r.is_demo ?? null,
      territories: mine.map((t) => ({ id: t.id, label: t.label, tier: t.tier })),
      logos: Array.from(new Map(myLogos.map((l) => [l.org_id, { org_id: l.org_id, name: l.name }])).values()),
      professionals: mine.reduce((s, t) => s + num(t.agent_count), 0),
      offices: mine.reduce((s, t) => s + num(t.office_count), 0),
      production: {
        month: sumPeriod(rows, "month"),
        quarter: sumPeriod(rows, "quarter"),
        year: sumPeriod(rows, "year"),
      },
      quota,
    };
  });

  const bySourceMap = new Map<string, number>();
  revenue
    .filter((r) => inPeriod(String(r.period_start), "year"))
    .forEach((r) => bySourceMap.set(r.source ?? "other", (bySourceMap.get(r.source ?? "other") ?? 0) + num(r.amount)));

  const logos = Array.from(
    new Map(
      links.map((l) => {
        const t = terrs.find((x) => x.id === l.territory_id);
        return [l.org_id, { org_id: l.org_id, name: l.name, tier: t?.tier ?? "—", territory: t?.label ?? "—" }];
      }),
    ).values(),
  );

  const expansion = ((expQ.data ?? []) as any[]).map((e) => ({
    org_id: e.org_id,
    org_name: e.org_name,
    year: Number(e.year),
    first_booking_at: e.first_booking_at,
    baseline: num(e.baseline),
    ytd_revenue: num(e.ytd_revenue),
    new_revenue: num(e.new_revenue),
    expansion_revenue: num(e.expansion_revenue),
    expansion_pct: e.expansion_pct == null ? null : Number(e.expansion_pct),
  })) as LogoExpansion[];

  const thisYear = now.getUTCFullYear();

  const sellerIds = Array.from(new Set(terrs.map((t) => t.seller_id).filter(Boolean))) as string[];
  const outsideIds = sellerIds.filter((id) => !members.some((m) => m.id === id));
  const outsideQ = { data: (fam.sellers ?? []).filter((r: any) => outsideIds.includes(r.id)) };
  const sellerName = new Map<string, string>([
    ...members.map((m) => [m.id, m.name] as [string, string]),
    ...((outsideQ.data ?? []) as any[]).map((r) => [r.id as string, r.name as string] as [string, string]),
  ]);

  const territories = terrs.map((t) => ({
    id: t.id as string,
    label: t.label as string,
    tier: t.tier as string,
    seller: t.seller_id ? (sellerName.get(t.seller_id) ?? null) : null,
    inTeam: members.some((m) => m.id === t.seller_id),
    logos: links.filter((l) => l.territory_id === t.id).length,
    offices: num(t.office_count),
    professionals: num(t.agent_count),
  }));

  return {
    groupKey,
    familyKey,
    label: ((groupQ.data ?? []) as any[]).find((g) => g.group_key === (familyKey ?? groupKey))?.label ?? groupKey,
    members,
    logos,
    territories,
    totals: {
      logos: logos.length,
      offices: terrs.reduce((s, t) => s + num(t.office_count), 0),
      professionals: terrs.reduce((s, t) => s + num(t.agent_count), 0),
      territories: terrs.length,
    },
    production: {
      month: sumPeriod(revenue, "month"),
      quarter: sumPeriod(revenue, "quarter"),
      year: sumPeriod(revenue, "year"),
    },
    bySource: Array.from(bySourceMap, ([source, amount]) => ({ source, amount })).sort(
      (a, b) => b.amount - a.amount,
    ),
    months: ((monthQ.data ?? []) as any[]).map((m) => ({
      month_start: m.month_start,
      month_revenue: num(m.month_revenue),
      cumulative_revenue: num(m.cumulative_revenue),
    })),
    expansion,
    expansionThisYear: expansion.find((e) => e.year === thisYear) ?? null,
    periodBounds: pb,
  };
}
