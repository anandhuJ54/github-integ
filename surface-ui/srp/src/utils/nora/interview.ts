import {
  entityBrief,
  type Cardinality,
  type CategoryBrief,
  type EntityBrief,
} from "@v3/srp/utils/category-brief";
import type { SkillRun, Verdict } from "@v3/srp/utils/nora/skill-run";
import type {
  CandidateFacts,
  Conflict,
  ExtractResult,
  ProposedNode,
} from "@v3/srp/utils/nora/extract/types";
// Copied from lib/nora/organize/web-sweep.ts (server-side; ported to FastAPI).
type SweepCandidate = {
  url: string;
  title: string;
  snippet: string;
  rank: number;
  query: string;
  hints: {
    platform: string | null;
    dedupe_key: string;
    duplicate_of: number | null;
    same_site: boolean;
    already_known: boolean;
    name_match: number;
    geo_match: boolean;
    phone_match: boolean;
    score: number;
  };
};

/*
 * NORA first-run interview, steps 1–2 — pure view-model layer.
 *
 *   Step 1 "Claim + silent verification": claim status/tier from whichever claim flow is
 *     deployed (main's claim_queue + professionals.claimed today; the PR #58 claim gate's
 *     trust_tier when it merges) — one adapter, claimStepModel.
 *   Step 2 "Organize the internet": the spine skills run through runSkill (every action is
 *     an exp_skill_run row): discover_open_web (serp_fetch + page_fetch on the website on
 *     file) → harvest_hop2 (source_crawl to owned sites + the sweep results the owner tapped)
 *     → extract_category (nlp_extract with the category brief) → confirm_graph_nodes
 *     (graph_upsert, owner_verified).
 *
 * Everything the owner sees is labelled and shaped by the CategoryBrief: collection labels,
 * cardinality → UI (one = single field, few = chips, many = list with bulk accept), identity
 * keys. No per-category code. No I/O here (tests/nora-interview.test.ts).
 */

/* ───────── Spine ───────── */

/** Interview step-2 skills (exp_skill_registry keys), in run order. Category-agnostic spine. */
export const ORGANIZE_SKILLS = {
  sweep: "discover_open_web",
  hop: "harvest_hop2",
  extract: "extract_category",
  confirm: "confirm_graph_nodes",
} as const;
export type OrganizePhase = keyof typeof ORGANIZE_SKILLS;

/** Seat kind (the record the owner claimed) — professionals row or organizations row. */
export type SubjectKind = "professional" | "office";

export type InterviewSubject = {
  kind: SubjectKind;
  id: string;
  name: string;
  gcid: string | null;
  websiteUrl: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  claimed: boolean | null;
};

/**
 * The brief entity type this record is interviewed as. A professionals row is the
 * brief's "professional"; an organizations row is the brief's "location" (the brief's
 * per-place type). Falls back to the brief's primary type when the brief lacks it.
 * (Single-pro offices — exp_office_mode — will pass the professional kind here.)
 */
export function interviewEntityType(brief: CategoryBrief, kind: SubjectKind): string | null {
  const want = kind === "professional" ? "professional" : "location";
  if (brief.entityTypes.some((e) => e.type === want)) return want;
  return brief.primaryEntityType;
}

/* ───────── Step 1 — claim (adapter over both claim flows) ───────── */

export type ClaimTier = 0 | 1 | 2;
export const CLAIM_TIER_LABEL: Record<ClaimTier, string> = {
  0: "T0 · authenticated",
  1: "T1 · identity + email verified",
  2: "T2 · ownership proven",
};

/** Raw claim inputs. Fields are optional so main's flow and the PR #58 gate both fit. */
export type ClaimSource = {
  /** professionals.claimed / organizations.claimed. */
  recordClaimed: boolean | null;
  /** Latest claim_queue row for this record (select * — PR #58 adds trust_tier). */
  queue: {
    status?: string | null;
    confidence_score?: number | null;
    confidence_signals?: Record<
      string,
      { matched?: boolean; weight?: number; detail?: string }
    > | null;
    trust_tier?: number | null;
    match_method?: string | null;
    created_at?: string | null;
  } | null;
};

export type ClaimStep = {
  state: "claimed" | "pending" | "unclaimed";
  /** null when the deployed claim flow records no tier (main before PR #58). */
  tier: ClaimTier | null;
  tierLabel: string;
  confidence: number | null;
  method: string | null;
  signals: { key: string; label: string; matched: boolean; detail: string | null }[];
  /** Organize may preview (dry run) from T0; owner confirmation needs a verified claim (T1). */
  canPreview: boolean;
  canConfirm: boolean;
  summary: string;
};

const PENDING = new Set([
  "pending",
  "pending_verification",
  "pending_review",
  "manual_review",
  "conflict",
]);
const GRANTED = new Set(["approved", "auto_approved"]);

const SIGNAL_LABEL: Record<string, string> = {
  email_domain: "Email domain matches the profile",
  email_exact: "Email matches the profile exactly",
  name: "Google name matches the profile",
  license: "License number matches",
};

export function claimStepModel(src: ClaimSource): ClaimStep {
  const q = src.queue;
  const rawTier = q?.trust_tier;
  const tier = rawTier === 0 || rawTier === 1 || rawTier === 2 ? (rawTier as ClaimTier) : null;
  const status = (q?.status ?? "").toLowerCase();
  const state: ClaimStep["state"] =
    src.recordClaimed || GRANTED.has(status)
      ? "claimed"
      : PENDING.has(status)
        ? "pending"
        : "unclaimed";
  const signals = Object.entries(q?.confidence_signals ?? {}).map(([key, s]) => ({
    key,
    label: SIGNAL_LABEL[key] ?? key.replace(/_/g, " "),
    matched: !!s?.matched,
    detail: s?.detail ? String(s.detail) : null,
  }));
  const confidence = q?.confidence_score ?? null;
  // Before PR #58 a granted claim has no tier column: a granted claim is at least identity-verified.
  const effectiveTier: ClaimTier = tier ?? (state === "claimed" ? 1 : 0);
  const tierLabel =
    tier != null ? CLAIM_TIER_LABEL[tier] : state === "claimed" ? "Verified claim" : "Not verified";
  const summary =
    state === "claimed"
      ? `Claimed${confidence != null ? ` · verification confidence ${confidence}/100` : ""} — nothing to type.`
      : state === "pending"
        ? "Your claim is being verified. You can preview what NORA finds; saving waits for verification."
        : "This profile is not claimed yet. You can preview what NORA finds; saving needs a verified claim.";
  return {
    state,
    tier,
    tierLabel,
    confidence,
    method: q?.match_method ?? null,
    signals,
    canPreview: true,
    canConfirm: state === "claimed" && effectiveTier >= 1,
    summary,
  };
}

/* ───────── Run results (exp_skill_run rows from runSkill) ───────── */

export type RunView = {
  skill: string;
  mode: string;
  verdict: Verdict | null;
  /** True when the capabilities this view needs produced outputs (dry run included). */
  produced: boolean;
  blockers: string[];
  unimplemented: string[];
  error: string | null;
};

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** One capability's outputs from a run row (outputs.capabilities[key]). */
export function capabilityOutput<T = Record<string, unknown>>(
  run: Pick<SkillRun, "outputs"> | null,
  key: string,
): T | null {
  const caps = obj(obj(run?.outputs).capabilities);
  return key in caps ? (caps[key] as T) : null;
}

export function runView(run: SkillRun, needs: string[]): RunView {
  const out = obj(run.outputs);
  const gov = obj(out.governance);
  return {
    skill: run.skill_key,
    mode: run.mode,
    verdict: run.verdict,
    produced: needs.every((k) => capabilityOutput(run, k) != null),
    blockers: Array.isArray(gov.live_blockers) ? (gov.live_blockers as string[]) : [],
    unimplemented: Array.isArray(out.unimplemented) ? (out.unimplemented as string[]) : [],
    error: run.error,
  };
}

/* ───────── Step 2a — sweep + website ───────── */

export function sweepInputs(
  subject: InterviewSubject,
  brief: CategoryBrief,
  entityType: string | null,
) {
  const geo = [subject.city, subject.state].filter(Boolean).join(", ") || null;
  return {
    ...(subject.websiteUrl ? { url: subject.websiteUrl } : {}),
    entity_name: subject.name,
    category_name: brief.displayName,
    ...(geo ? { geo } : {}),
    gcid: brief.gcid,
    ...(entityType ? { entity_type: entityType } : {}),
  };
}

export type SweepRow = {
  url: string;
  title: string;
  snippet: string;
  platform: string | null;
  /** Pre-ticked: the entity's own site, or a URL already known from its pages. */
  likelyYou: boolean;
  matches: string[];
};

export type SweepModel = {
  status: "live" | "not_configured" | "not_run";
  reason: string | null;
  rows: SweepRow[];
  website: {
    url: string | null;
    ok: boolean;
    error: string | null;
    facts: CandidateFacts | null;
    ownedUrls: string[];
  };
};

type SerpOut = { status?: string; reason?: string; candidates?: SweepCandidate[] } | null;
type PageOut = {
  url?: string;
  ok?: boolean;
  error?: string | null;
  facts?: CandidateFacts | null;
} | null;

export function sweepModel(run: Pick<SkillRun, "outputs"> | null): SweepModel {
  const serp = capabilityOutput<SerpOut>(run, "serp_fetch");
  const page = capabilityOutput<PageOut>(run, "page_fetch");
  const facts = page?.facts ?? null;
  const rows: SweepRow[] = [];
  for (const c of serp?.candidates ?? []) {
    if (c.hints.duplicate_of != null) continue;
    const m: string[] = [];
    if (c.hints.same_site) m.push("your website");
    if (c.hints.phone_match) m.push("phone");
    if (c.hints.geo_match) m.push("city");
    if (c.hints.name_match >= 0.5) m.push("name");
    rows.push({
      url: c.url,
      title: c.title,
      snippet: c.snippet,
      platform: c.hints.platform,
      likelyYou: c.hints.same_site || c.hints.already_known,
      matches: m,
    });
  }
  return {
    status: serp == null ? "not_run" : serp.status === "live" ? "live" : "not_configured",
    reason: serp && serp.status !== "live" ? (serp.reason ?? "web sweep is not configured") : null,
    rows,
    website: {
      url: page?.url ?? null,
      ok: !!page?.ok && !!facts && !facts.blocked,
      error: page?.error ?? (facts?.blocked ? "site blocked the fetch" : null),
      facts,
      ownedUrls: (facts?.links.ownedCandidates ?? []).map((o) => o.url),
    },
  };
}

/* ───────── Step 2b — hop to owned sites (+ tapped sweep results) ───────── */

export function hopInputs(sweep: SweepModel, tapped: string[], base: Record<string, unknown>) {
  const site = sweep.website.url;
  const owned = [...new Set([...sweep.website.ownedUrls, ...tapped])].filter((u) => u !== site);
  return {
    ...base,
    owned_candidates: owned,
    // nlp_extract in this skill reads the website page; the full extraction runs next.
    ...(sweep.website.facts ? { pages: [sweep.website.facts] } : {}),
  };
}

type CrawlOut = {
  pages?: { url?: string; ok?: boolean; error?: string | null; facts?: CandidateFacts | null }[];
} | null;

/** All organized pages so far: the website first, then each hop page that parsed. */
export function organizedPages(
  sweep: SweepModel,
  hopRun: Pick<SkillRun, "outputs"> | null,
): CandidateFacts[] {
  const out: CandidateFacts[] = [];
  const seen = new Set<string>();
  const add = (f: CandidateFacts | null | undefined) => {
    if (!f || f.blocked || seen.has(f.source_url)) return;
    seen.add(f.source_url);
    out.push(f);
  };
  add(sweep.website.facts);
  for (const p of capabilityOutput<CrawlOut>(hopRun, "source_crawl")?.pages ?? []) add(p.facts);
  return out;
}

export function extractInputs(pages: CandidateFacts[], base: Record<string, unknown>) {
  // owned_candidates: [] keeps this skill's source_crawl from re-fetching (hop already ran).
  return { ...base, pages, owned_candidates: [] };
}

/* ───────── Step 2c — review model (brief + extract result → UI) ───────── */

export type CardinalityUi = "single" | "chips" | "list";
export const UI_FOR: Record<Cardinality, CardinalityUi> = {
  one: "single",
  few: "chips",
  many: "list",
};

export type ReviewItem = {
  id: string;
  title: string;
  value: string;
  detail: string | null;
  evidence: string;
  sourceUrl: string;
  method: string;
  confidence: number;
};

export type ReviewField = ReviewItem & { key: string; label: string; identityKey: boolean };

export type ReviewCollection = {
  key: string;
  label: string;
  cardinality: Cardinality;
  ui: CardinalityUi;
  /** many-collections get select-all / clear. */
  bulk: boolean;
  expected: { min: number; max: number };
  items: ReviewItem[];
};

export type ReviewConflict = {
  key: string;
  label: string;
  options: { value: string; evidence: string; sourceUrl: string; confidence: number }[];
};

export type ReviewModel = {
  entityType: string;
  entityNoun: string;
  /** Single-valued facts (identity keys first, in brief order). */
  fields: ReviewField[];
  collections: ReviewCollection[];
  /** Collection labels the brief expects but nothing was found for. */
  missing: string[];
  conflicts: ReviewConflict[];
  /** Item ids pre-selected (everything found; the owner un-ticks what isn't theirs). */
  defaultSelected: string[];
};

export const itemId = (
  n: Pick<
    ProposedNode,
    "cardinality_group" | "registry_node_slug" | "node_type" | "schema_property" | "value"
  >,
) =>
  [
    n.cardinality_group.collection ?? "one",
    n.registry_node_slug ?? n.node_type,
    n.schema_property,
    n.value,
  ].join("|");

const toItem = (n: ProposedNode): ReviewItem => {
  const d = obj(n.extracted_data);
  const parts = [d.price, d.section, d.description].filter(
    (x) => typeof x === "string" && x.trim(),
  ) as string[];
  return {
    id: itemId(n),
    title: n.title,
    value: n.value,
    detail: parts.length ? parts.join(" · ") : null,
    evidence: n.evidence,
    sourceUrl: n.source_url,
    method: n.method,
    confidence: n.confidence,
  };
};

/** Label for a single-valued property: identity key label → registry node name → property. */
function oneLabel(eb: EntityBrief, schemaProperty: string, slug: string | null): string {
  const ik = eb.identityKeys.find((k) => k.schemaProperty === schemaProperty);
  if (ik) return ik.label;
  const node = slug ? eb.nodes.find((n) => n.nodeSlug === slug) : null;
  if (node?.nodeName) return node.nodeName;
  return schemaProperty.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

export function reviewModel(brief: CategoryBrief, extract: ExtractResult): ReviewModel {
  const eb = entityBrief(brief, extract.entity_type);
  if (!eb) throw new Error(`category ${brief.gcid} has no entity type ${extract.entity_type}`);

  const fields: ReviewField[] = [];
  const byCollection = new Map<string, ProposedNode[]>();
  for (const n of extract.nodes) {
    const c = n.cardinality_group.collection;
    if (c && eb.collections.some((x) => x.key === c))
      byCollection.set(c, [...(byCollection.get(c) ?? []), n]);
    else
      fields.push({
        ...toItem(n),
        key: n.registry_node_slug ?? n.schema_property,
        label: oneLabel(eb, n.schema_property, n.registry_node_slug),
        identityKey: eb.identityKeys.some((k) => k.schemaProperty === n.schema_property),
      });
  }
  const ikOrder = (f: ReviewField) => {
    const i = eb.identityKeys.findIndex((k) => k.schemaProperty === f.key || k.label === f.label);
    return i === -1 ? eb.identityKeys.length : i;
  };
  fields.sort((a, b) => Number(b.identityKey) - Number(a.identityKey) || ikOrder(a) - ikOrder(b));

  const collections: ReviewCollection[] = [];
  const missing: string[] = [];
  for (const c of eb.collections) {
    const nodes = byCollection.get(c.key) ?? [];
    if (!nodes.length) {
      // Only page-observable collections are "missing" from an organize pass.
      if (c.connectionMethods.some((m) => m === "manual" || m === "etl")) missing.push(c.label);
      continue;
    }
    collections.push({
      key: c.key,
      label: c.label,
      cardinality: c.cardinality,
      ui: UI_FOR[c.cardinality],
      bulk: c.cardinality === "many",
      expected: c.expectedCount,
      items: nodes.map(toItem),
    });
  }

  const conflicts: ReviewConflict[] = extract.conflicts.map((c) => ({
    key: c.key,
    label: oneLabel(eb, c.schema_property, c.registry_node_slug),
    options: c.candidates.map((o) => ({
      value: o.value,
      evidence: o.evidence,
      sourceUrl: o.source_url,
      confidence: o.confidence,
    })),
  }));

  return {
    entityType: eb.type,
    entityNoun: brief.labels.entityNoun,
    fields,
    collections,
    missing,
    conflicts,
    defaultSelected: [
      ...fields.map((f) => f.id),
      ...collections.flatMap((c) => c.items.map((i) => i.id)),
    ],
  };
}

/* ───────── Step 2d — confirm (owner-picked facts → graph_upsert) ───────── */

/** A conflict pick → the node graph_upsert writes (ring/name from the brief's registry node). */
export function conflictNode(
  brief: CategoryBrief,
  entityType: string,
  c: Conflict,
  pick: number,
  confirmedAt: string = new Date().toISOString(),
): ProposedNode | null {
  const cand = c.candidates[pick];
  if (!cand) return null;
  const eb = entityBrief(brief, entityType);
  const node = c.registry_node_slug
    ? eb?.nodes.find((n) => n.nodeSlug === c.registry_node_slug)
    : null;
  return {
    registry_node_id: c.registry_node_id,
    registry_node_slug: c.registry_node_slug,
    node_type: c.node_type,
    schema_property: c.schema_property,
    ring: node?.ring ?? null,
    title: cand.value,
    value: cand.value,
    extracted_data: { picked_from: c.candidates.length, resolved_by: "owner" },
    source_url: cand.source_url,
    fetched_at: confirmedAt,
    confidence: 1,
    method: cand.method,
    evidence: cand.evidence,
    cardinality_group: { collection: null, cardinality: "one", vocabulary_term: null },
  };
}

/**
 * Owner-confirmed nodes: every ticked proposal plus one node per resolved conflict.
 * Unresolved conflicts are held (never written) — same rule as graph_upsert.
 */
export function confirmedNodes(
  brief: CategoryBrief,
  extract: ExtractResult,
  selected: Iterable<string>,
  picks: Record<string, number | undefined>,
  confirmedAt?: string,
): ProposedNode[] {
  const keep = new Set(selected);
  const out = extract.nodes.filter((n) => keep.has(itemId(n)));
  for (const c of extract.conflicts) {
    const p = picks[c.key];
    if (p == null) continue;
    const n = conflictNode(brief, extract.entity_type, c, p, confirmedAt);
    if (n) out.push(n);
  }
  return out;
}

/** graph_upsert inputs for owner-confirmed facts: owner_verified trust, user source. */
export function confirmInputs(
  nodes: ProposedNode[],
  extract: Pick<ExtractResult, "gcid" | "entity_type">,
) {
  return {
    nodes,
    trust: "owner_verified" as const,
    source: "user" as const,
    gcid: extract.gcid,
    entity_type: extract.entity_type,
  };
}
