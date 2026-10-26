import { api } from "@v3/state/api/server-fn";
import { rollupClaimBuckets, type LogoClaimSignal } from "@v3/sales/utils/logo-intelligence";
import { loadComp, commissionByRep } from "@v3/sales/utils/comp";
import { loadSellerBoard, type SellerCard } from "@v3/sales/utils/seller-board";
import { loadActivity, loadContracts, loadPriceBook, loadReps, type PriceBookRow, type Rep } from "@v3/sales/utils/sales";
import { listPromos, type Promo } from "@v3/sales/utils/sales-cpq";
import { loadTeamsSummary, loadGroupTeams, type TeamsSummary, type TeamRow } from "@v3/sales/utils/teams";

/** FastAPI: surface-api/sales/routers/spine_data.py (runs as the signed-in user). */
const SP = "/sales/spine";

export type SalesScope = { kind: "all" } | { kind: "team"; teamId: string; label: string };
export type ClaimEvent = {
  id: string;
  entity_id: string | null;
  entity_label: string | null;
  entity_type: string | null;
  event_type: string | null;
  group_key: string | null;
  logo_org_id: string | null;
  nora_engagement: number | null;
  occurred_at: string | null;
  seller_id: string | null;
  state: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  upgraded: boolean | null;
  is_demo: boolean | null;
};

export type ScopeDashboardData = {
  scope: SalesScope;
  locations: number | null;
  profileVisits: number | null;
  attemptedClaims: number;
  successfulClaims: number;
  upgrades: number;
  arr: number | null;
  claims: ClaimEvent[];
  categories: { key: string; attempted: number; successful: number; upgrades: number }[];
  logos: { id: string; name: string; logoUrl: string | null; claims: number; upgrades: number }[];
  teams: TeamsSummary["groups"];
  teamRows: TeamRow[];
  reps: Rep[];
  activitySignals: number | null;
  logosRemaining: number | null;
  /** Distinct logos on active/won contracts (handed to Success), rep-scoped at team level. */
  wonToSuccess: number;
  /** Per-group live rollup for Leaderboards / Revenue / Staffing focuses. */
  teamsLive: TeamLive[];
  /** Enterprise selling-stage funnel (live from exp_sales_pipeline), scoped. */
  pipelineStages: PipelineStage[];
  pipelineTotal: number | null;
};

export type TeamLive = {
  groupKey: string;
  label: string;
  offices: number;
  agents: number;
  attempted: number;
  successful: number;
  upgrades: number;
  revenue: number;
  sres: number;
};
export type PipelineStage = { stage: string; value: number; count: number };

const STAGE_ORDER = ["qualification", "discovery", "design", "demo", "proposal", "contract", "negotiation"];
const stageLabel = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

const successTypes = new Set(["claimed", "engaged", "upgraded"]);
const WON = new Set(["active", "won"]);

/** Annual list price of monthly subscription products for one scope. */
const annualSubs = (book: PriceBookRow[], scope: string) =>
  book.filter((p) => p.billing_type === "subscription" && p.unit === "month" && p.scope === scope && p.product_key && Number(p.list_price ?? 0) > 0)
    .map((p) => ({ key: p.product_key as string, annual: Number(p.list_price) * 12 }));

export async function loadScopeDashboard(scope: SalesScope): Promise<ScopeDashboardData> {
  const groupKey = scope.kind === "team" ? scope.teamId : null;
  const [scopeQ, reps, summary, activity] = await Promise.all([
    // claims (the oldest 1000), territories, metrics, contracts, open pipeline: one request
    api.get<{
      claims: ClaimEvent[];
      territories: { office_count: number | null; brand_count: number | null }[];
      metrics: { views: number | null }[];
      contracts: { mrr: number | null; status: string | null; sold_by: string | null; org_id?: string | null }[];
      pipeline: { stage: string | null; value: number | null; owner: string | null }[];
    }>(`${SP}/scope`, { params: { group_key: groupKey || undefined } }),
    loadReps(),
    loadTeamsSummary(),
    loadActivity(30),
  ]);

  const scopedReps = groupKey ? reps.filter((rep) => rep.group_key === groupKey) : reps;
  const repIds = new Set(scopedReps.map((rep) => rep.id));
  const claims = ((scopeQ.claims ?? []) as ClaimEvent[]).filter((row) => !groupKey || row.group_key === groupKey || (!!row.seller_id && repIds.has(row.seller_id)));
  const territories = (scopeQ.territories ?? []) as { office_count: number | null; brand_count: number | null }[];
  const metrics = (scopeQ.metrics ?? []) as { views: number | null }[];
  const contracts = (scopeQ.contracts ?? []) as { mrr: number | null; status: string | null; sold_by: string | null }[];
  const activeContracts = contracts.filter((row) => row.status === "active" && (!groupKey || (!!row.sold_by && repIds.has(row.sold_by))));

  const catMap = new Map<string, { key: string; attempted: number; successful: number; upgrades: number }>();
  for (const row of claims) {
    const key = row.group_key ?? "unassigned";
    const current = catMap.get(key) ?? { key, attempted: 0, successful: 0, upgrades: 0 };
    if (row.event_type === "attempted") current.attempted += 1;
    if (successTypes.has(row.event_type ?? "")) current.successful += 1;
    if (row.upgraded) current.upgrades += 1;
    catMap.set(key, current);
  }

  const logoIds = [...new Set(claims.map((row) => row.logo_org_id).filter((id): id is string => !!id))];
  const logoRows = logoIds.length
    ? await api.post<{ id: string; name: string; logo_url: string | null }[]>(`${SP}/scope-logos`, { ids: logoIds })
    : [];
  const logoInfo = new Map(((logoRows ?? []) as { id: string; name: string; logo_url: string | null }[]).map((row) => [row.id, row]));
  const logos = logoIds.map((id) => {
    const rows = claims.filter((row) => row.logo_org_id === id);
    const info = logoInfo.get(id);
    return { id, name: info?.name ?? id, logoUrl: info?.logo_url ?? null, claims: rows.length, upgrades: rows.filter((row) => row.upgraded).length };
  }).sort((a, b) => b.claims - a.claims);

  const totalBrands = territories.reduce((sum, row) => sum + Number(row.brand_count ?? 0), 0);
  const wonLogoCount = new Set(claims.filter((row) => row.upgraded && row.logo_org_id).map((row) => row.logo_org_id)).size;
  const teamData = groupKey ? await loadGroupTeams(groupKey) : null;
  const activitySignals = activity.filter((row) => !groupKey || scopedReps.some((rep) => rep.name === row.actor)).length;

  // Per-group live revenue from active contracts, keyed by the selling rep's group.
  const repGroup = new Map(reps.map((rep) => [rep.id, rep.group_key]));
  const sreByGroup = new Map<string, number>();
  for (const rep of reps) if (/^(srx|sre)$/i.test(rep.role ?? "")) sreByGroup.set(rep.group_key, (sreByGroup.get(rep.group_key) ?? 0) + 1);
  const revByGroup = new Map<string, number>();
  for (const row of contracts as { mrr: number | null; status: string | null; sold_by: string | null }[]) {
    if (row.status !== "active" || !row.sold_by) continue;
    const gk = repGroup.get(row.sold_by);
    if (!gk) continue;
    revByGroup.set(gk, (revByGroup.get(gk) ?? 0) + Number(row.mrr ?? 0) * 12);
  }
  const groupsForRollup = groupKey ? summary.groups.filter((g) => g.group.group_key === groupKey) : summary.groups;
  const teamsLive: TeamLive[] = groupsForRollup.map((g) => {
    const cat = catMap.get(g.group.group_key);
    return {
      groupKey: g.group.group_key,
      label: g.group.label,
      offices: g.offices,
      agents: g.agents,
      attempted: cat?.attempted ?? 0,
      successful: cat?.successful ?? 0,
      upgrades: cat?.upgrades ?? 0,
      revenue: revByGroup.get(g.group.group_key) ?? 0,
      sres: sreByGroup.get(g.group.group_key) ?? 0,
    };
  }).sort((a, b) => b.successful - a.successful);

  const pipelineRows = ((scopeQ.pipeline ?? []) as { stage: string | null; value: number | null; owner: string | null }[])
    .filter((row) => !groupKey || (!!row.owner && repIds.has(row.owner)));
  const stageMap = new Map<string, { value: number; count: number }>();
  for (const row of pipelineRows) {
    const key = (row.stage ?? "other").toLowerCase();
    const cur = stageMap.get(key) ?? { value: 0, count: 0 };
    cur.value += Number(row.value ?? 0); cur.count += 1;
    stageMap.set(key, cur);
  }
  const pipelineStages: PipelineStage[] = [...stageMap.entries()]
    .sort((a, b) => { const ai = STAGE_ORDER.indexOf(a[0]); const bi = STAGE_ORDER.indexOf(b[0]); return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi); })
    .map(([stage, v]) => ({ stage: stageLabel(stage), value: v.value, count: v.count }));
  const pipelineTotal = pipelineRows.length ? pipelineRows.reduce((sum, row) => sum + Number(row.value ?? 0), 0) : null;

  return {
    scope,
    locations: territories.length ? territories.reduce((sum, row) => sum + Number(row.office_count ?? 0), 0) : null,
    profileVisits: metrics.length ? metrics.reduce((sum, row) => sum + Number(row.views ?? 0), 0) : null,
    attemptedClaims: claims.filter((row) => row.event_type === "attempted").length,
    successfulClaims: claims.filter((row) => successTypes.has(row.event_type ?? "")).length,
    upgrades: claims.filter((row) => row.upgraded).length,
    arr: activeContracts.length ? activeContracts.reduce((sum, row) => sum + Number(row.mrr ?? 0) * 12, 0) : null,
    claims,
    categories: [...catMap.values()].sort((a, b) => b.successful - a.successful),
    logos,
    teams: groupKey ? summary.groups.filter((row) => row.group.group_key === groupKey) : summary.groups,
    teamRows: teamData?.teams ?? [],
    reps: scopedReps,
    activitySignals: activity.length ? activitySignals : null,
    logosRemaining: territories.length ? Math.max(0, totalBrands - wonLogoCount) : null,
    wonToSuccess: new Set((contracts as { status: string | null; sold_by: string | null; org_id?: string | null }[]).filter((row) => WON.has(row.status ?? "") && row.org_id && (!groupKey || (!!row.sold_by && repIds.has(row.sold_by)))).map((row) => row.org_id)).size,
    teamsLive,
    pipelineStages,
    pipelineTotal,
  };
}

export type WorklistLogo = {
  id: string;
  name: string;
  logoUrl: string | null;
  locations: number | null;
  claimed: number;
  warm: number;
  upgraded: number;
  revenue: number | null;
  engagement: number;
  headroom: number | null;
};

export type RowCommercial = { spend: number; notSold: number; headroom: number; bundle: string | null };
export type ProfileMeta = { score: number | null; nodes: number | null };

export type WorklistData = {
  reps: Rep[];
  selectedRep: Rep | null;
  sellerCard: SellerCard | null;
  claims: ClaimEvent[];
  attempted: ClaimEvent[];
  warm: ClaimEvent[];
  outside: ClaimEvent[];
  upgrades: ClaimEvent[];
  logos: WorklistLogo[];
  commission: number | null;
  revenueMtd: number | null;
  pipeline: number | null;
  quotaPct: number | null;
  promos: Promo[];
  priceBookAvailable: boolean;
  commercial: Record<string, RowCommercial>;
  profileMeta: Record<string, ProfileMeta>;
  upgradeHeadroom: number | null;
  wonToSuccess: number;
  opportunities: { id: string; name: string; stage: string; value: number | null; expected_close: string | null }[];
};

export async function loadWorklist(repId: string | null): Promise<WorklistData> {
  const [reps, sellerBoard, comp, promos, priceBook, worklistQ, contractBook] = await Promise.all([
    loadReps(),
    loadSellerBoard(),
    loadComp(),
    listPromos(),
    loadPriceBook(),
    // claims (the newest 1000) and the 500 most recently updated open opportunities: one request
    api.get<{
      claims: ClaimEvent[];
      opportunities: { id: string; name: string; stage: string; value: number | null; expected_close: string | null; owner: string | null }[];
    }>(`${SP}/worklist`),
    loadContracts(),
  ]);
  const wonContracts = contractBook.contracts.filter((c) => WON.has(c.status));
  const ownedByOrg = new Map<string, Set<string>>();
  const spendByOrg = new Map<string, number>();
  for (const c of wonContracts) {
    if (!c.org_id) continue;
    const keys = ownedByOrg.get(c.org_id) ?? new Set<string>();
    for (const li of contractBook.lineItems) if (li.contract_id === c.id && li.product_key) keys.add(li.product_key);
    ownedByOrg.set(c.org_id, keys);
    spendByOrg.set(c.org_id, (spendByOrg.get(c.org_id) ?? 0) + Number(c.mrr ?? 0) * 12);
  }
  const commercialFor = (row: ClaimEvent): RowCommercial | null => {
    const scope = row.entity_type === "professional" ? "professional" : row.entity_type === "location" ? "location" : null;
    if (!scope) return null;
    const owned = row.logo_org_id ? ownedByOrg.get(row.logo_org_id) ?? new Set<string>() : new Set<string>();
    const open = annualSubs(priceBook, scope).filter((p) => !owned.has(p.key)).sort((a, b) => b.annual - a.annual);
    return { spend: row.logo_org_id ? spendByOrg.get(row.logo_org_id) ?? 0 : 0, notSold: open.length, headroom: open.reduce((s, p) => s + p.annual, 0), bundle: open[0]?.key ?? null };
  };
  const selectedRep = reps.find((rep) => rep.id === repId) ?? null;
  const sellerCard = sellerBoard.cards.find((card) => card.repId === repId) ?? null;
  const allClaims = (worklistQ.claims ?? []) as ClaimEvent[];
  const claims = repId ? allClaims.filter((row) => row.seller_id === repId) : allClaims;
  const buckets = rollupClaimBuckets(claims as LogoClaimSignal[]);
  const claimed = claims.filter((row) => successTypes.has(row.event_type ?? ""));
  const warm = buckets.warmUp as ClaimEvent[];
  const outside = buckets.outsideWarmUp as ClaimEvent[];
  // Logos assigned to the rep's territory seats (or territories they sell) belong in their whitespace
  // even when the claim events are attributed to the territory's SRE.
  const seatLogoIds = new Set<string>();
  if (repId) {
    // the rep's seat and owned territories, then their brands: one request
    const tb = await api.get<{ seats: { territory_id: string }[]; owned: { id: string }[]; brands: { org_id: string | null }[] }>(
      `${SP}/reps/${encodeURIComponent(repId)}/territory-brands`,
    );
    for (const r of tb.brands ?? []) if (r.org_id) seatLogoIds.add(r.org_id);
  }
  const logoIds = [...new Set([...claims.map((row) => row.logo_org_id).filter((id): id is string => !!id), ...seatLogoIds])];
  const orgRows = logoIds.length
    ? await api.post<{ id: string; name: string; logo_url: string | null; parent_org_id: string | null }[]>(`${SP}/worklist-logos`, { ids: logoIds })
    : [];
  // the per-logo location counts (one count per logo, null where it failed): one request
  const locationCounts = logoIds.length
    ? await api.post<Record<string, number | null>>(`${SP}/location-counts`, { ids: logoIds })
    : {};
  const orgs = new Map(((orgRows ?? []) as { id: string; name: string; logo_url: string | null }[]).map((row) => [row.id, row]));
  const logos = logoIds.map((id) => {
    const rows = (seatLogoIds.has(id) ? allClaims : claims).filter((row) => row.logo_org_id === id);
    const locations = locationCounts[id] ?? null; // null: the count failed
    const org = orgs.get(id);
    return {
      id,
      name: org?.name ?? id,
      logoUrl: org?.logo_url ?? null,
      locations,
      claimed: rows.filter((row) => successTypes.has(row.event_type ?? "")).length,
      warm: rollupClaimBuckets(rows as LogoClaimSignal[]).warmUp.length,
      upgraded: rollupClaimBuckets(rows as LogoClaimSignal[]).upgraded.length,
      revenue: spendByOrg.has(id) ? spendByOrg.get(id) ?? 0 : null,
      headroom: locations == null ? null : annualSubs(priceBook, "location").filter((p) => !(ownedByOrg.get(id)?.has(p.key))).reduce((s, p) => s + p.annual, 0) * locations,
      engagement: rows.reduce((sum, row) => sum + Number(row.nora_engagement ?? 0), 0),
    } satisfies WorklistLogo;
  });
  const commission = repId ? commissionByRep(comp)[repId]?.commission ?? null : null;
  const commercial: Record<string, RowCommercial> = {};
  for (const row of outside) { const c = commercialFor(row); if (c) commercial[row.id] = c; }
  const profileMeta = await loadProfileMeta([...warm, ...outside]);
  return {
    commercial,
    profileMeta,
    upgradeHeadroom: Object.keys(commercial).length ? Object.values(commercial).reduce((s, c) => s + c.headroom, 0) : null,
    wonToSuccess: new Set(wonContracts.filter((c) => c.org_id && (!repId || c.sold_by === repId)).map((c) => c.org_id)).size,
    reps,
    selectedRep,
    sellerCard,
    claims,
    attempted: buckets.attempted as ClaimEvent[],
    warm,
    outside,
    upgrades: buckets.upgraded as ClaimEvent[],
    logos: logos.sort((a, b) => b.engagement - a.engagement),
    commission,
    revenueMtd: sellerCard?.actual ?? null,
    pipeline: sellerCard?.pipelineOpen ?? null,
    quotaPct: sellerCard?.pct ?? null,
    promos,
    priceBookAvailable: priceBook.length > 0,
    opportunities: ((worklistQ.opportunities ?? []) as { id: string; name: string; stage: string; value: number | null; expected_close: string | null; owner: string | null }[])
      .filter((row) => !repId || row.owner === repId || row.owner === selectedRep?.name)
      .map(({ owner: _owner, ...row }) => row),
  };
}

/** Score from search_rank_scores and graph node count per entity; null where no row exists. */
async function loadProfileMeta(rows: ClaimEvent[]): Promise<Record<string, ProfileMeta>> {
  const ids = [...new Set(rows.map((r) => r.entity_id).filter((id): id is string => !!id))];
  const out: Record<string, ProfileMeta> = {};
  if (!ids.length) return out;
  const scores = new Map<string, number>();
  const nodes = new Map<string, number>();
  // per 200-id chunk: scores and active graph node rows, each chunk's read capped at 1000 on its own
  const meta = await api.post<{ scores: { entity_id: string; total_score: number | null }[]; nodes: { entity_id: string }[] }>(
    `${SP}/profile-meta`,
    { ids },
  );
  for (const r of meta.scores ?? []) if (r.total_score != null) scores.set(r.entity_id, Number(r.total_score));
  for (const r of meta.nodes ?? []) nodes.set(r.entity_id, (nodes.get(r.entity_id) ?? 0) + 1);
  for (const id of ids) out[id] = { score: scores.get(id) ?? null, nodes: nodes.get(id) ?? null };
  return out;
}
