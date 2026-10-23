// ============================================================================
// disco-detail-api-worker (2026-10-14) — harvest one profile from the site's own profile API.
//
// The fetch tick sends a detail_page here (instead of disco-harvest-worker) when the source's saved contract
// has site_contract.detail_route.record_source 'api' or 'api+page' (proven at mapping, see -disco-detail-api.ts).
// Input and reply are the same as disco-harvest-worker's, so exp_etl_fetch_collect stages the record unchanged:
//   - 'api':      the record is built from the profile API's JSON with the contract's JSON field map;
//   - 'api+page': the profile page is fetched too and fills the fields the JSON lacks (JSON wins on both);
//   - the API call fails or returns another profile: the record is built from the page ('page_fallback').
// detail_url stays the profile page URL (duplicates, publishing links). payload._contract.detail_source says
// which source was used. No AI. Nothing is written here (the collector stages the reply).
// Dry run: { dry_run: true, url, domain, gcid, crawl_method, contract? } — contract (a site contract object with
// detail_route) may be passed for a site that has no saved contract yet; the reply is the same.
// ============================================================================
import { createFileRoute } from '@tanstack/react-router';
import { scrapeWebsite, looksBlocked, type CrawlMethod } from './disco-webscraper-worker';
import {
  applySiteContract, applyAddressOwner, buildHarvestRecord, applyExtraFields, collectSiteEntityNames, looksNotFound,
  buildStaticRoutes, filterTaxonomyRows, resolveTaxonomyKeys, isMergeableId, applyValueRules,
  type SiteContract, type StaticRoute, type TaxonomyRow,
} from './-disco-site-contract';
import { fetchDetailFor, jsonValues, type DetailApi } from './-disco-detail-api';

const VALID_CRAWL_METHODS: CrawlMethod[] = ['server_crawl', 'needs_proxy', 'needs_js_api', 'direct'];
const CACHE_TTL_MS = 10 * 60_000;
type DetailRoute = { record_source?: 'api' | 'api+page' | 'page'; api?: DetailApi | null; json_fields?: Record<string, string> | null };
type Row = {
  domain: string; category_slug: string; detail_pattern: string | null; field_floor: number | null; detail_entity_type: string | null;
  extraction: { site_contract?: SiteContract & { detail_route?: DetailRoute } } | null; source_type?: string | null;
  routes?: Record<string, StaticRoute[]>;
};
const rowCache = new Map<string, { at: number; row: Row | null }>();
const namesCache = new Map<string, { at: number; names: Set<string> }>();

// Same contract read as disco-harvest-worker (that file is left unchanged): latest contract row, source type,
// and the category's generic taxonomy routes after the contract's own (single-value ids only).
async function loadRow(domain: string, gcid: string): Promise<Row | null> {
  const key = `${domain}|${gcid}`;
  const hit = rowCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.row;
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const db = supabaseAdmin as any;
  const { data, error } = await db.from('disco_site_contract')
    .select('domain, category_slug, detail_pattern, field_floor, detail_entity_type, learned_at, extraction')
    .eq('domain', domain).eq('category_slug', gcid).order('learned_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`contract lookup failed: ${error.message}`);
  const row = (data as Row | null) ?? null;
  if (row) {
    const { data: src } = await db.from('exp_etl_sources').select('source_type').eq('source_domain', domain).eq('gcid', gcid).limit(1).maybeSingle();
    row.source_type = (src?.source_type as string | null) ?? null;
    row.routes = await routesFor(gcid, row.extraction?.site_contract ?? null);
  }
  rowCache.set(key, { at: Date.now(), row });
  return row;
}
async function routesFor(gcid: string, contract: SiteContract | null): Promise<Record<string, StaticRoute[]>> {
  const saved = (contract?.static_routes ?? {}) as Record<string, StaticRoute[]>;
  if (!contract?.primary_subject || !contract.taxonomy_fields || !Object.keys(contract.taxonomy_fields).length) return saved;
  try {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: reg } = await (supabaseAdmin as any).from('exp_vertical_node_registry')
      .select('node_slug, node_name, node_description, schema_type, schema_property, entity_scope, owns_lane')
      .eq('gcid', gcid).eq('is_active', true);
    const taxKeys = resolveTaxonomyKeys(filterTaxonomyRows((reg ?? []) as TaxonomyRow[]), contract.primary_subject);
    const generic = buildStaticRoutes({
      fields: {}, taxonomyFields: contract.taxonomy_fields, taxKeys, primary: contract.primary_subject,
      extraFields: {}, extraCandidates: {}, extraValues: [], sampleUrls: [],
    }).routes;
    const out: Record<string, StaticRoute[]> = {};
    for (const [sid, rs] of Object.entries(saved)) if (Array.isArray(rs)) out[sid] = [...rs];
    for (const [sid, rs] of Object.entries(generic)) {
      if (isMergeableId(sid) || !Array.isArray(rs)) continue;
      const taxOnly = rs.filter((r) => r.kind === 'taxonomy');
      if (taxOnly.length) out[sid] = [...(out[sid] ?? []), ...taxOnly];
    }
    return out;
  } catch { return saved; }
}
function matchesPattern(url: string, pattern: string | null): boolean {
  if (!pattern) return false;
  try { const re = new RegExp(pattern); return re.test(url) || re.test(url.split('#')[0].split('?')[0]); } catch { return false; }
}
async function siteNames(domain: string, contract: SiteContract, crawl_method: CrawlMethod): Promise<Set<string>> {
  if (Array.isArray(contract.site_entity_names)) return new Set(contract.site_entity_names);
  const key = `${domain}|${contract.learned_at}`;
  const hit = namesCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.names;
  const home = await scrapeWebsite({ url: `https://${domain}/`, crawl_method });
  const names = home.ok && home.content ? collectSiteEntityNames(home.content) : new Set<string>();
  namesCache.set(key, { at: Date.now(), names });
  return names;
}
const empty = (v: unknown) => v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

type Body = { url?: string; domain?: string; gcid?: string; crawl_method?: CrawlMethod; frontier_id?: unknown; dry_run?: boolean; contract?: unknown; detail_pattern?: string; field_floor?: number };

async function handle(request: Request): Promise<Response> {
  if (request.method !== 'POST') return Response.json({ error: 'POST required' }, { status: 405 });
  const workerKey = process.env['DISCO_WORKER_KEY'];
  if (!workerKey || request.headers.get('x-disco-worker-key') !== workerKey) return Response.json({ error: 'unauthorized' }, { status: 401 });
  let body: Body;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const { url, domain, gcid, crawl_method } = body ?? {};
  if (!url || !domain || !gcid || !crawl_method) return Response.json({ error: 'url, domain, gcid and crawl_method are required' }, { status: 400 });
  if (!VALID_CRAWL_METHODS.includes(crawl_method)) return Response.json({ error: `crawl_method must be one of ${VALID_CRAWL_METHODS.join(', ')}` }, { status: 400 });
  const frontier_id = body.frontier_id ?? null;
  try {
    // Dry run with a contract passed in (for a site without a saved contract); otherwise the saved contract.
    const given = body.dry_run === true && body.contract && typeof body.contract === 'object' ? body.contract as SiteContract & { detail_route?: DetailRoute } : null;
    const row: Row | null = given
      ? { domain, category_slug: gcid, detail_pattern: typeof body.detail_pattern === 'string' ? body.detail_pattern : null, field_floor: Number(body.field_floor ?? 0) || null,
          detail_entity_type: null, extraction: { site_contract: given }, routes: (given.static_routes ?? {}) as Record<string, StaticRoute[]> }
      : await loadRow(domain, gcid);
    const contract = row?.extraction?.site_contract;
    if (!row || !contract || Number(contract.version ?? 0) < 3) return Response.json({ ok: false, frontier_id, url, reason: 'no_contract' });
    if (!matchesPattern(url, row.detail_pattern)) return Response.json({ ok: false, frontier_id, url, reason: 'not_detail_page' });
    const dr = contract.detail_route ?? {};
    const mode = dr.record_source === 'api' || dr.record_source === 'api+page' ? dr.record_source : 'page';

    // 1. Profile API.
    let apiValues: Record<string, unknown> | null = null;
    let apiWhy = 'no profile api in the contract';
    let apiUrl: string | undefined;
    if (mode !== 'page' && dr.api && dr.json_fields && Object.keys(dr.json_fields).length) {
      const got = await fetchDetailFor(dr.api, url, 30_000);
      apiWhy = got.why; apiUrl = got.api_url;
      if (got.json !== undefined) apiValues = jsonValues(got.json, dr.json_fields);
    }
    const source: 'api' | 'api+page' | 'page_fallback' = apiValues ? (mode === 'api' ? 'api' : 'api+page') : 'page_fallback';

    // 2. Profile page (api+page, or the API did not answer for this profile).
    let pageValues: Record<string, unknown> = {};
    let extras: Record<string, unknown> = {};
    let firmRelabelled: string[] = [];
    let page: { resolved_url?: string | null; status_code?: number | null } = {};
    if (source !== 'api') {
      const p = await scrapeWebsite({ url, crawl_method });
      page = { resolved_url: p.resolved_url, status_code: p.status_code };
      if (!p.ok || !p.content || looksBlocked(p.status_code, p.content)) {
        if (!apiValues) {
          const blocked = looksBlocked(p.status_code, p.content);
          return Response.json({ ok: false, frontier_id, url, reason: blocked && p.content ? 'blocked' : 'fetch_failed', status_code: p.status_code, error: p.error ?? null, api: apiWhy });
        }
      } else {
        const names = await siteNames(domain, contract, crawl_method);
        const firmSignatures = new Set(contract.firm_signatures ?? []);
        const applied = applySiteContract(p.content, url, contract, names, { firmSignatures });
        pageValues = applied.values; firmRelabelled = applied.firmRelabelled;
        if (!apiValues && looksNotFound(p.content, applyAddressOwner(pageValues, contract))) {
          return Response.json({ ok: false, frontier_id, url, reason: 'not_detail_page', detail: 'not_found' });
        }
        extras = applyExtraFields(p.content, url, contract, names, { firmSignatures });
      }
    }

    // 3. Merge: the JSON value wins where both have one; the page fills the rest.
    const merged: Record<string, unknown> = { ...pageValues };
    for (const [k, v] of Object.entries(apiValues ?? {})) if (!empty(v)) merged[k] = v;
    // Fix (taxonomy copies on profile-API records, 2026-10-15): the contract's value-only rules (address parts, taxonomy
    // copies of universal fields) run on the merged values, so an API record gets them as a page record does.
    const filled = applyAddressOwner(applyValueRules(merged, contract, url), contract);
    const ownKey = contract.own_page_key;
    if (row.source_type === 'brand_site' && ownKey && empty(filled['tax.' + ownKey])) filled['tax.' + ownKey] = url;
    const record = buildHarvestRecord({
      contract: { ...contract, static_routes: row.routes ?? contract.static_routes },
      values: filled, detailUrl: url, detailEntityType: row.detail_entity_type, fieldFloor: row.field_floor, firmRelabelled, extras,
    });
    const meta = (record.payload._contract ?? {}) as Record<string, unknown>;
    record.payload._contract = { ...meta, detail_source: source, ...(source === 'page_fallback' && mode !== 'page' ? { api_issue: apiWhy } : {}) };
    return Response.json({
      ok: true, frontier_id, url, resolved_url: page.resolved_url ?? null, status_code: page.status_code ?? 200,
      contract_version: contract.version, detail_source: source, api_url: apiUrl ?? null, record,
      ...(body.dry_run === true ? { dry_run: true, api_values: apiValues, page_fields: Object.keys(pageValues).filter((k) => !empty(pageValues[k])).length } : {}),
    });
  } catch (error) {
    return Response.json({ ok: false, frontier_id, url, reason: 'error', error: String(error) }, { status: 500 });
  }
}

export const Route = createFileRoute('/api/public/disco-detail-api-worker')({
  server: { handlers: { POST: ({ request }) => handle(request) } },
});
