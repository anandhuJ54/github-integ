// ============================================================================
// disco-harvest-worker — rule-based harvest of ONE detail page (Phase B).
//
// Applies the site contract learned by mapSite (extraction.site_contract,
// version >= 3) to a single page, without AI. Reads disco_site_contract only;
// writes NOTHING to the database (persistence is done by the SQL collector).
//
// Trigger: POST /api/public/disco-harvest-worker with header x-disco-worker-key,
// body { url, domain, gcid, crawl_method, frontier_id? }.
// ============================================================================
import { createFileRoute } from '@tanstack/react-router';
import { scrapeWebsite, looksBlocked, type CrawlMethod } from './disco-webscraper-worker';
import {
  applySiteContract,
  applyAddressOwner,
  buildHarvestRecord,
  applyExtraFields,
  collectSiteEntityNames,
  looksNotFound,
  buildStaticRoutes,
  filterTaxonomyRows,
  resolveTaxonomyKeys,
  isMergeableId,
  type SiteContract,
  type StaticRoute,
  type TaxonomyRow,
} from './-disco-site-contract';

const VALID_CRAWL_METHODS: CrawlMethod[] = ['server_crawl', 'needs_proxy', 'needs_js_api', 'direct'];
const CACHE_TTL_MS = 10 * 60_000;

type ContractRow = {
  domain: string;
  category_slug: string;
  detail_pattern: string | null;
  field_floor: number | null;
  detail_entity_type: string | null;
  learned_at: string | null;
  extraction: { site_contract?: SiteContract } | null;
  /** C2: exp_etl_sources.source_type for (domain, gcid), read with the contract row. */
  source_type?: string | null;
  /** Fix (generic taxonomy routes, 2026-10-12): contract routes + the category's generic routes. */
  routes?: Record<string, StaticRoute[]>;
};

const rowCache = new Map<string, { at: number; row: ContractRow | null }>();
const namesCache = new Map<string, { at: number; names: Set<string> }>();

async function loadContractRow(domain: string, gcid: string): Promise<ContractRow | null> {
  const key = `${domain}|${gcid}`;
  const hit = rowCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.row;
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { data, error } = await (supabaseAdmin as any)
    .from('disco_site_contract')
    .select('domain, category_slug, detail_pattern, field_floor, detail_entity_type, learned_at, extraction')
    .eq('domain', domain)
    .eq('category_slug', gcid) // stored exactly as 'gcid:xxx'
    .order('learned_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`contract lookup failed: ${error.message}`);
  const row = (data as ContractRow | null) ?? null;
  if (row) {
    // C2: source type (read only), cached together with the contract row.
    const { data: src } = await (supabaseAdmin as any)
      .from('exp_etl_sources')
      .select('source_type')
      .eq('source_domain', domain)
      .eq('gcid', gcid)
      .limit(1)
      .maybeSingle();
    row.source_type = (src?.source_type as string | null) ?? null;
    row.routes = await harvestRoutes(gcid, row.extraction?.site_contract ?? null);
  }
  // Cache key includes learned_at implicitly: a re-learned contract replaces the entry after TTL.
  rowCache.set(key, { at: Date.now(), row });
  return row;
}

/**
 * Fix (generic taxonomy routes, 2026-10-12): the harvest used only the routes saved in the contract when the site
 * was mapped. Mapping skips a static id that has a page rule, so when that rule finds nothing at harvest the value
 * shown under a taxonomy key with the same meaning (registry schema.org property + subject) was never copied — e.g.
 * a bio captured as 'advisor_biography' (Person.description). The harvest now also applies the category's generic
 * taxonomy routes, the same ones the staging backfill computes: single-value ids only, after the contract's own
 * routes, so they only fill a value that is still empty (page rule and contract routes win). Nothing site-specific;
 * the registry read is cached with the contract row.
 */
async function harvestRoutes(gcid: string, contract: SiteContract | null): Promise<Record<string, StaticRoute[]>> {
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
      if (isMergeableId(sid) || !Array.isArray(rs)) continue; // lists keep the contract's own routes only
      const taxOnly = rs.filter((r) => r.kind === 'taxonomy');
      if (taxOnly.length) out[sid] = [...(out[sid] ?? []), ...taxOnly];
    }
    return out;
  } catch (e) {
    console.error('generic taxonomy routes failed', e);
    return saved;
  }
}

export function matchesDetailPattern(url: string, pattern: string | null): boolean {
  if (!pattern) return false;
  let re: RegExp;
  try { re = new RegExp(pattern); } catch { return false; }
  if (re.test(url)) return true;
  const stripped = url.split('#')[0].split('?')[0];
  return re.test(stripped);
}

async function siteNamesFor(row: ContractRow, contract: SiteContract, crawl_method: CrawlMethod): Promise<Set<string>> {
  if (Array.isArray(contract.site_entity_names)) return new Set(contract.site_entity_names);
  const key = `${row.domain}|${row.category_slug}|${contract.learned_at}`;
  const hit = namesCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.names;
  const home = await scrapeWebsite({ url: `https://${row.domain}/`, crawl_method });
  const names = home.ok && home.content ? collectSiteEntityNames(home.content) : new Set<string>();
  namesCache.set(key, { at: Date.now(), names });
  return names;
}

type Body = { url?: string; domain?: string; gcid?: string; crawl_method?: CrawlMethod; frontier_id?: unknown };

export async function handleHarvest(request: Request): Promise<Response> {
  if (request.method !== 'POST') return Response.json({ error: 'POST required' }, { status: 405 });
  const workerKey = process.env['DISCO_WORKER_KEY'];
  if (!workerKey || request.headers.get('x-disco-worker-key') !== workerKey) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  let body: Body;
  try { body = await request.json(); } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { url, domain, gcid, crawl_method } = body ?? {};
  if (!url || !domain || !gcid || !crawl_method) {
    return Response.json({ error: 'url, domain, gcid and crawl_method are required' }, { status: 400 });
  }
  if (!VALID_CRAWL_METHODS.includes(crawl_method)) {
    return Response.json({ error: `crawl_method must be one of ${VALID_CRAWL_METHODS.join(', ')}` }, { status: 400 });
  }
  const frontier_id = body.frontier_id ?? null;

  try {
    const row = await loadContractRow(domain, gcid);
    const contract = row?.extraction?.site_contract;
    if (!row || !contract || Number(contract.version ?? 0) < 3) {
      return Response.json({ ok: false, frontier_id, url, reason: 'no_contract' });
    }
    if (!matchesDetailPattern(url, row.detail_pattern)) {
      return Response.json({ ok: false, frontier_id, url, reason: 'not_detail_page' });
    }

    const page = await scrapeWebsite({ url, crawl_method });
    if (!page.ok || !page.content) {
      const blocked = looksBlocked(page.status_code, page.content);
      return Response.json({
        ok: false, frontier_id, url,
        reason: blocked && page.content ? 'blocked' : 'fetch_failed',
        status_code: page.status_code, error: page.error ?? null,
      });
    }
    if (looksBlocked(page.status_code, page.content)) {
      return Response.json({ ok: false, frontier_id, url, reason: 'blocked', status_code: page.status_code, error: page.error ?? null });
    }

    const siteEntityNames = await siteNamesFor(row, contract, crawl_method);
    const firmSignatures = new Set(contract.firm_signatures ?? []);
    const { values, firmRelabelled } = applySiteContract(page.content, url, contract, siteEntityNames, { firmSignatures });
    const filledValues = applyAddressOwner(values, contract);
    // Station 5: a 200 page that reads as "not found" (removed profile) is
    // skipped — reason 'not_detail_page' makes the SQL collector mark it
    // skipped, so nothing is staged and it never counts in the gate sample.
    if (looksNotFound(page.content, filledValues)) {
      return Response.json({ ok: false, frontier_id, url, reason: 'not_detail_page', detail: 'not_found' });
    }
    // C2: on brand sites the page itself is the entity's own page.
    const ownKey = contract.own_page_key;
    if (row.source_type === 'brand_site' && ownKey) {
      const k = 'tax.' + ownKey;
      const cur = filledValues[k];
      if (cur == null || (typeof cur === 'string' && cur.trim() === '')) filledValues[k] = url;
    }
    // C14: extra fields (staging only, never promoted).
    const extras = applyExtraFields(page.content, url, contract, siteEntityNames, { firmSignatures });
    const record = buildHarvestRecord({
      contract: { ...contract, static_routes: row.routes ?? contract.static_routes },
      values: filledValues,
      detailUrl: url,
      detailEntityType: row.detail_entity_type,
      fieldFloor: row.field_floor,
      firmRelabelled,
      extras,
    });
    return Response.json({
      ok: true, frontier_id, url,
      resolved_url: page.resolved_url,
      status_code: page.status_code,
      contract_version: contract.version,
      record,
    });
  } catch (error) {
    return Response.json({ ok: false, frontier_id, url, reason: 'error', error: String(error) }, { status: 500 });
  }
}

export const Route = createFileRoute('/api/public/disco-harvest-worker')({
  server: {
    handlers: {
      POST: ({ request }) => handleHarvest(request),
    },
  },
});
