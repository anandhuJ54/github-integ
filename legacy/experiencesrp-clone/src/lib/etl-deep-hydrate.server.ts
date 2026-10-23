// ============================================================================
// DEEP-HYDRATION writer. Takes a parsed State Farm agent page and lands it in:
//   1. exp_etl_staging.payload (+ field_tier='deep')
//   2. the matching professionals row (enrichment)
//   3. graph_nodes for the professional (ring 2 products/socials, ring 3 licenses)
//   4. team members as professionals under the same office (Location) + credential
// Deterministic. No AI. Service-role client is supplied by the caller.
// ============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseStateFarmAgent, parseOk, type SfDeepFields } from "./etl-statefarm";

const BRAND_ORG_ID = "bbbbbbb1-0000-4000-8000-000000000001"; // State Farm brand org
const LICENSE_TYPE = "Insurance Producer License";
const GCID = "gcid:insurance_agency";

type Db = SupabaseClient<any, "public", any>;

export type StagingRow = {
  stage_id: string;
  detail_url: string | null;
  payload: Record<string, unknown> | null;
};

export type HydrationResult = {
  stage_id: string;
  detail_url: string;
  ok: boolean;
  shallow?: boolean;
  gate_reasons?: string[];
  error?: string;
  professional_id?: string;
  office_id?: string;
  field_count?: number;
  products?: number;
  socials?: number;
  licenses?: number;
  team?: number;
  has_bio?: boolean;
  created_professional?: boolean;
  created_team?: number;
};

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

async function hashSlug(prefix: string, seed: string, len: number) {
  const bytes = new TextEncoder().encode(seed);
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${prefix}${hex.slice(0, len)}`;
}

function splitName(full: string) {
  const parts = full.trim().split(/\s+/);
  return {
    first: parts[0] ?? full,
    last: parts.length > 1 ? parts.slice(1).join(" ") : "",
  };
}

export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export async function fetchAgentHtml(url: string, timeoutMs = 20000): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        "upgrade-insecure-requests": "1",
      },
    });
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// --- office (Location) -------------------------------------------------------
async function ensureOffice(db: Db, f: SfDeepFields): Promise<string | null> {
  const officeName = f.name ? `${f.name} — State Farm` : null;
  if (!officeName) return null;

  if (f.street && f.city && f.state) {
    const { data } = await db
      .from("organizations")
      .select("id")
      .eq("entity_type", "office")
      .eq("address_street", f.street)
      .eq("address_city", f.city)
      .eq("address_state", f.state)
      .limit(1);
    if (data?.length) return String(data[0]["id"]);
  }

  const { data: byName } = await db
    .from("organizations")
    .select("id")
    .eq("entity_type", "office")
    .eq("name", officeName)
    .eq("address_city", f.city ?? "")
    .limit(1);
  if (byName?.length) return String(byName[0]["id"]);

  const slug = await hashSlug("sf-office-", `${f.detail_url}|office`, 16);
  const { data: created, error } = await db
    .from("organizations")
    .insert({
      name: officeName,
      slug,
      entity_type: "office",
      gcid: GCID,
      schema_type: "Organization",
      parent_org_id: BRAND_ORG_ID,
      address_street: f.street,
      address_city: f.city,
      address_state: f.state,
      address_zip: f.postal_code,
      address_country: "US",
      latitude: f.latitude,
      longitude: f.longitude,
      phone: f.phone,
      website_url: f.website_url,
      logo_url: f.logo,
      gbp_place_id: f.gbp_place_id,
      is_active: true,
      is_demo: false,
    })
    .select("id")
    .single();
  if (error) throw new Error(`office insert: ${error.message}`);
  return String(created["id"]);
}

// --- professional ------------------------------------------------------------
async function findProfessional(db: Db, f: SfDeepFields) {
  const { data: byUrl } = await db
    .from("professionals")
    .select("id")
    .eq("canonical_url", f.detail_url)
    .limit(1);
  if (byUrl?.length) return String(byUrl[0]["id"]);

  // Phone is office-unique for State Farm agents: strongest secondary key.
  const phoneDigits = digits(f.phone);
  if (phoneDigits.length === 10) {
    const { data: byPhone } = await db
      .from("professionals")
      .select("id, phone, display_name")
      .or(`phone.eq.${f.phone},phone.eq.${phoneDigits}`)
      .limit(5);
    const hit = (byPhone ?? []).find(
      (r) => digits(String(r["phone"] ?? "")) === phoneDigits,
    );
    if (hit) return String(hit["id"]);
  }

  if (!f.name || !f.city || !f.state) return null;

  const { data } = await db
    .from("professionals")
    .select("id, phone")
    .eq("display_name", f.name)
    .eq("address_city", f.city)
    .eq("address_state", f.state)
    .limit(20);
  if (!data?.length) return null;
  const phone = digits(f.phone);
  const exact = data.find((r) => phone && digits(String(r["phone"] ?? "")) === phone);
  return String((exact ?? data[0])["id"]);
}

async function upsertProfessional(db: Db, f: SfDeepFields, officeId: string | null) {
  const primary = f.licenses.find((l) => l.primary) ?? f.licenses[0] ?? null;
  const patch: Record<string, unknown> = {
    display_name: f.name,
    headline: f.city && f.state ? `State Farm Insurance Agent — ${f.city}, ${f.state}` : null,
    bio: f.bio,
    short_bio: f.short_bio,
    photo_url: f.photo_url,
    cover_photo_url: f.cover_photo_url,
    canonical_url: f.detail_url,
    job_title: "State Farm Agent",
    phone: f.phone,
    website_url: f.website_url,
    address_city: f.city,
    address_state: f.state,
    address_zip: f.postal_code,
    gbp_place_id: f.gbp_place_id,
    primary_license_number: primary?.number ?? null,
    primary_license_type: primary ? LICENSE_TYPE : null,
    primary_license_state: primary?.state ?? null,
    languages: f.languages.length ? f.languages : null,
    markets_served: f.area_served.length ? f.area_served : null,
    same_as: f.social.length ? f.social.map((s) => s.url) : null,
    schema_type: "InsuranceAgency",
    gcid: GCID,
    is_active: true,
    is_demo: false,
    updated_at: new Date().toISOString(),
  };
  if (officeId) patch["primary_org_id"] = officeId;

  const existing = await findProfessional(db, f);
  if (existing) {
    const { error } = await db.from("professionals").update(patch).eq("id", existing);
    if (error) throw new Error(`pro update: ${error.message}`);
    return { id: existing, created: false };
  }

  const name = splitName(f.name ?? "Unknown");
  const slug = await hashSlug("sf-", f.detail_url, 24);
  const { data, error } = await db
    .from("professionals")
    .insert({ ...patch, first_name: name.first, last_name: name.last, slug })
    .select("id")
    .single();
  if (error) throw new Error(`pro insert: ${error.message}`);
  return { id: String(data["id"]), created: true };
}

// --- graph nodes ------------------------------------------------------------
type NodeRow = Record<string, unknown>;

function nodesFor(entityId: string, f: SfDeepFields): NodeRow[] {
  const base = {
    entity_type: "professional",
    entity_id: entityId,
    source: "etl",
    source_url: f.detail_url,
    fetched_at: new Date().toISOString(),
    is_active: true,
    verified: false,
  };
  const rows: NodeRow[] = [];
  for (const p of f.products) {
    rows.push({
      ...base,
      ring: 2,
      node_type: "product_service",
      title: p.name,
      url: p.url,
      schema_property: "makesOffer",
      extracted_data: { description: p.description },
    });
  }
  for (const s of f.social) {
    rows.push({
      ...base,
      ring: 2,
      node_type: "social_profile",
      title: s.platform,
      url: s.url,
      schema_property: "sameAs",
    });
  }
  for (const l of f.licenses) {
    rows.push({
      ...base,
      ring: 3,
      node_type: "credential",
      title: l.raw,
      schema_property: "hasCredential",
      extracted_data: {
        license_number: l.number,
        license_state: l.state,
        license_type: LICENSE_TYPE,
        primary: l.primary,
      },
    });
  }
  return rows;
}

async function replaceEtlNodes(db: Db, entityId: string, rows: NodeRow[]) {
  const { error: delErr } = await db
    .from("graph_nodes")
    .delete()
    .eq("entity_type", "professional")
    .eq("entity_id", entityId)
    .eq("source", "etl")
    .in("node_type", ["product_service", "social_profile", "credential"]);
  if (delErr) throw new Error(`node delete: ${delErr.message}`);
  if (!rows.length) return;
  const { error } = await db.from("graph_nodes").insert(rows);
  if (error) throw new Error(`node insert: ${error.message}`);
}

// --- team members -----------------------------------------------------------
async function upsertTeam(db: Db, f: SfDeepFields, officeId: string | null) {
  if (!officeId) return 0;
  let created = 0;
  for (const m of f.team) {
    const name = splitName(m.name);
    const slug = await hashSlug("sf-", `${f.detail_url}|team|${m.name}`, 24);
    const patch: Record<string, unknown> = {
      display_name: m.name,
      first_name: name.first,
      last_name: name.last,
      job_title: m.role,
      bio: m.description,
      photo_url: m.photo_url,
      primary_org_id: officeId,
      address_city: f.city,
      address_state: f.state,
      address_zip: f.postal_code,
      gcid: GCID,
      schema_type: "Person",
      primary_license_number: m.license,
      primary_license_type: m.license ? LICENSE_TYPE : null,
      primary_license_state: f.state,
      is_active: true,
      is_demo: false,
      updated_at: new Date().toISOString(),
    };

    const { data: existing } = await db.from("professionals").select("id").eq("slug", slug).limit(1);
    let id: string;
    if (existing?.length) {
      id = String(existing[0]["id"]);
      const { error } = await db.from("professionals").update(patch).eq("id", id);
      if (error) throw new Error(`team update: ${error.message}`);
    } else {
      const { data, error } = await db
        .from("professionals")
        .insert({ ...patch, slug })
        .select("id")
        .single();
      if (error) throw new Error(`team insert: ${error.message}`);
      id = String(data["id"]);
      created += 1;
    }

    if (m.license) {
      await replaceEtlNodes(db, id, [
        {
          entity_type: "professional",
          entity_id: id,
          source: "etl",
          source_url: f.detail_url,
          fetched_at: new Date().toISOString(),
          is_active: true,
          verified: false,
          ring: 3,
          node_type: "credential",
          title: `Lic# ${m.license}`,
          schema_property: "hasCredential",
          extracted_data: {
            license_number: m.license,
            license_state: f.state,
            license_type: LICENSE_TYPE,
            role: m.role,
          },
        },
      ]);
    }
  }
  return created;
}

// --- FIELD-YIELD GATE -------------------------------------------------------
// Category-scoped quality floor. A record below the floor looks like an index /
// listing capture rather than a detail capture: it is flagged and NEVER promoted
// to professionals / organizations.
export type FieldFloor = {
  gcid: string;
  min_fields: number;
  required_keys: string[];
  min_products: number;
  min_licenses: number;
};

export const DEFAULT_FLOOR: FieldFloor = {
  gcid: "*",
  min_fields: 8,
  required_keys: [],
  min_products: 0,
  min_licenses: 0,
};

export async function loadFieldFloor(db: Db, gcid: string): Promise<FieldFloor> {
  const { data } = await db
    .from("exp_etl_field_floors")
    .select("gcid, min_fields, required_keys, min_products, min_licenses")
    .eq("gcid", gcid)
    .maybeSingle();
  return data ? (data as unknown as FieldFloor) : { ...DEFAULT_FLOOR, gcid };
}

export type GateVerdict = { passed: boolean; reasons: string[]; field_count: number };

export function gateFields(f: SfDeepFields, floor: FieldFloor): GateVerdict {
  const reasons: string[] = [];
  if (f.field_count < floor.min_fields) {
    reasons.push(`field_count ${f.field_count} < min_fields ${floor.min_fields}`);
  }
  if (f.products.length < floor.min_products) {
    reasons.push(`products ${f.products.length} < min ${floor.min_products}`);
  }
  if (f.licenses.length < floor.min_licenses) {
    reasons.push(`licenses ${f.licenses.length} < min ${floor.min_licenses}`);
  }
  const record = f as unknown as Record<string, unknown>;
  for (const key of floor.required_keys) {
    const v = record[key];
    const missing = v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length);
    if (missing) reasons.push(`missing required key '${key}'`);
  }
  return { passed: reasons.length === 0, reasons, field_count: f.field_count };
}

async function markShallow(
  db: Db,
  row: StagingRow,
  reasons: string[],
  f: SfDeepFields | null,
) {
  const payload = {
    ...(row.payload ?? {}),
    ...(f ?? {}),
    field_tier: "shallow",
    extraction: "sf_deep_v1",
    gate_passed: false,
    gate_reasons: reasons,
    gate_checked_at: new Date().toISOString(),
  };
  const { error } = await db
    .from("exp_etl_staging")
    .update({ payload, resolution_status: "shallow" })
    .eq("stage_id", row.stage_id);
  if (error) throw new Error(`staging shallow update: ${error.message}`);
}

// --- orchestration ----------------------------------------------------------
export async function hydrateStagingRow(
  db: Db,
  row: StagingRow,
  html: string,
  floor: FieldFloor,
  refetch?: (url: string) => Promise<string>,
): Promise<HydrationResult> {
  const url = row.detail_url ?? "";
  let f = parseStateFarmAgent(html, url);
  let verdict = parseOk(f)
    ? gateFields(f, floor)
    : { passed: false, reasons: ["no JSON-LD agency object on detail page"], field_count: f.field_count };

  // The gate re-checks once after a fresh deep extraction of the detail_url,
  // so a transient/partial fetch is not recorded as a shallow capture.
  if (!verdict.passed && refetch && url) {
    try {
      const retry = parseStateFarmAgent(await refetch(url), url);
      const retryVerdict = parseOk(retry)
        ? gateFields(retry, floor)
        : { passed: false, reasons: ["no JSON-LD agency object on detail page"], field_count: retry.field_count };
      if (retryVerdict.passed || retry.field_count > f.field_count) {
        f = retry;
        verdict = retryVerdict;
      }
    } catch {
      /* keep the first verdict */
    }
  }

  if (!verdict.passed) {
    await markShallow(db, row, verdict.reasons, parseOk(f) ? f : null);
    return {
      stage_id: row.stage_id,
      detail_url: url,
      ok: false,
      shallow: true,
      gate_reasons: verdict.reasons,
      field_count: verdict.field_count,
      error: `field-yield gate: ${verdict.reasons.join("; ")}`,
    };
  }

  const officeId = await ensureOffice(db, f);
  const pro = await upsertProfessional(db, f, officeId);
  await replaceEtlNodes(db, pro.id, nodesFor(pro.id, f));
  const createdTeam = await upsertTeam(db, f, officeId);

  // The governed staging table constrains field_tier to 'core' | 'enrichment',
  // so the deep tier is recorded as 'enrichment' with field_tier:'deep' in payload.
  const payload = {
    ...(row.payload ?? {}),
    ...f,
    field_tier: "deep",
    extraction: "sf_deep_v1",
    gate_passed: true,
    gate_reasons: [],
    hydrated_at: new Date().toISOString(),
  };
  const { error } = await db
    .from("exp_etl_staging")
    .update({ payload, field_tier: "enrichment", resolution_status: "created" })
    .eq("stage_id", row.stage_id);
  if (error) throw new Error(`staging update: ${error.message}`);

  return {
    stage_id: row.stage_id,
    detail_url: url,
    ok: true,
    professional_id: pro.id,
    office_id: officeId ?? undefined,
    field_count: f.field_count,
    products: f.products.length,
    socials: f.social.length,
    licenses: f.licenses.length,
    team: f.team.length,
    has_bio: Boolean(f.bio),
    created_professional: pro.created,
    created_team: createdTeam,
  };
}

export function summarize(results: HydrationResult[]) {
  const ok = results.filter((r) => r.ok);
  const pct = (n: number) => (ok.length ? Math.round((n / ok.length) * 1000) / 10 : 0);
  const sum = (f: (r: HydrationResult) => number) => ok.reduce((a, r) => a + f(r), 0);
  return {
    processed: results.length,
    parsed: ok.length,
    promoted: ok.length,
    shallow: results.filter((r) => r.shallow).length,
    failed: results.filter((r) => !r.ok && !r.shallow).length,
    avg_fields: ok.length ? Math.round((sum((r) => r.field_count ?? 0) / ok.length) * 10) / 10 : 0,
    pct_with_bio: pct(ok.filter((r) => r.has_bio).length),
    pct_with_products: pct(ok.filter((r) => (r.products ?? 0) > 0).length),
    pct_with_socials: pct(ok.filter((r) => (r.socials ?? 0) > 0).length),
    pct_with_licenses: pct(ok.filter((r) => (r.licenses ?? 0) > 0).length),
    pct_with_team: pct(ok.filter((r) => (r.team ?? 0) > 0).length),
    team_members_created: sum((r) => r.created_team ?? 0),
    professionals_created: ok.filter((r) => r.created_professional).length,
    failures: results
      .filter((r) => !r.ok)
      .map((r) => ({ url: r.detail_url, shallow: Boolean(r.shallow), error: r.error })),
  };
}

const PENDING_SELECT = "stage_id, detail_url, payload";

/** Rows still awaiting deep hydration: not yet deep, not gate-flagged shallow. */
export async function loadPendingStagingRows(
  db: Db,
  gcid: string,
  limit: number,
  includeUrls: string[] = [],
) {
  const rows: StagingRow[] = [];
  if (includeUrls.length) {
    const { data } = await db
      .from("exp_etl_staging")
      .select(PENDING_SELECT)
      .eq("gcid", gcid)
      .in("detail_url", includeUrls);
    for (const r of data ?? []) rows.push(r as StagingRow);
  }
  if (rows.length < limit) {
    const { data, error } = await db
      .from("exp_etl_staging")
      .select(PENDING_SELECT)
      .eq("gcid", gcid)
      .not("detail_url", "is", null)
      .neq("resolution_status", "shallow")
      .or("payload->>field_tier.is.null,payload->>field_tier.neq.deep")
      .order("observed_at", { ascending: true })
      .limit(limit);
    if (error) throw new Error(`queue load: ${error.message}`);
    const seen = new Set(rows.map((r) => r.stage_id));
    for (const r of data ?? []) {
      if (rows.length >= limit) break;
      if (seen.has(String(r["stage_id"]))) continue;
      rows.push(r as StagingRow);
    }
  }
  return rows.slice(0, limit);
}

/** Backwards-compatible alias used by the pilot runner. */
export const loadCoreStagingRows = (db: Db, limit: number, includeUrls: string[] = []) =>
  loadPendingStagingRows(db, "gcid:insurance_agent", limit, includeUrls);

export async function hydrationProgress(db: Db, gcid: string) {
  const count = async (build: (q: any) => any) => {
    const q = build(
      db.from("exp_etl_staging").select("stage_id", { count: "exact", head: true }).eq("gcid", gcid),
    );
    const { count: c } = await q;
    return c ?? 0;
  };
  const total = await count((q: any) => q);
  const deep = await count((q: any) => q.eq("payload->>field_tier", "deep"));
  const shallow = await count((q: any) => q.eq("resolution_status", "shallow"));
  return { gcid, total, deep, shallow, remaining: Math.max(total - deep - shallow, 0) };
}

