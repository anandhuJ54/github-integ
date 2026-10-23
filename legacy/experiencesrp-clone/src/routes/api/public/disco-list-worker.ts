// ============================================================================
// disco list worker — G3 (harvest any list route), 2026-10-13.
//
// Runs ONE list unit of a source's accepted list route (disco_site_contract
// .extraction.site_contract.list_route, proven by site mapper version 2 at mapping): one listing seed
// from a start page (up to 5 pages), one link_crawl hub page, or one autocomplete prefix. It returns the
// profile page URLs it found and the next units; exp_etl_fetch_collect queues them (profile pages as
// 'detail_page', units as 'list_page'). No AI, no cookies or login headers (version 2's own request
// rules), requests spaced by the source's min_delay_seconds (at most 10 s). This worker writes nothing.
//
// Queue rows: url = <list start url>#list=<unit> where <unit> is 'root:<source index>' (seeded by Run)
// or URI-encoded JSON of an engine ListUnit (made here).
//
// POST /api/public/disco-list-worker   header x-disco-worker-key
// body: { url, domain, gcid, crawl_method?, frontier_id? }            -> one unit (the fetch tick)
//       { dry_run: true, domain, gcid, url? | full: true, max_pages?, config? } -> dry run: one unit, or the
//         whole route with runConfig (counts only); config = a version 2 config to test before it is saved
// The leading 'disco-' keeps it in the file router like the other workers.
// ============================================================================
import { createFileRoute } from '@tanstack/react-router';
import * as E from './-disco-agent-engine';
import { oxyFetch } from './disco-agent-mapper';

const PAGES_PER_UNIT = 5;
const UNIT_BUDGET_MS = 200_000;

type Body = { url?: string; domain?: string; gcid?: string; crawl_method?: string; frontier_id?: unknown; dry_run?: boolean; full?: boolean; max_pages?: number; config?: any };

export function encodeListUnit(base: string, unit: E.ListUnit): string {
  return `${base.split('#')[0]}#list=${encodeURIComponent(JSON.stringify(unit))}`;
}
export function decodeListUnit(url: string): E.ListUnit | null {
  const i = url.indexOf('#list=');
  if (i < 0) return null;
  const raw = url.slice(i + 6);
  const root = /^root:(\d+)$/.exec(raw);
  if (root) return { s: Number(root[1]), k: 'root' };
  try {
    const u = JSON.parse(decodeURIComponent(raw));
    return u && typeof u.s === 'number' && typeof u.k === 'string' ? (u as E.ListUnit) : null;
  } catch { return null; }
}

async function loadRoute(domain: string, gcid: string): Promise<{ config: any; delaySec: number } | null> {
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const db = supabaseAdmin as any;
  const { data: row } = await db.from('disco_site_contract')
    .select('domain, detail_pattern, extraction').eq('domain', domain).eq('category_slug', gcid)
    .order('learned_at', { ascending: false }).limit(1).maybeSingle();
  const lr = row?.extraction?.site_contract?.list_route;
  if (!row || !lr || !Array.isArray(lr.sources) || !lr.sources.length) return null;
  const { data: src } = await db.from('exp_etl_sources').select('min_delay_seconds')
    .eq('source_domain', domain).eq('gcid', gcid).limit(1).maybeSingle();
  return {
    config: {
      version: 2, domain, start_url: lr.start_url ?? `https://${domain}/`,
      // the harvest's own profile page pattern, so list results match what the queue classifies as profile pages
      profile_url_pattern: row.detail_pattern ?? lr.profile_url_pattern ?? null,
      strip_query: false, render: lr.render ?? false, headers: {}, sources: lr.sources,
    },
    delaySec: Math.max(0, Math.min(10, Number(src?.min_delay_seconds ?? 5))),
  };
}

/** oxyFetch with the source's spacing between requests (one request at a time per unit). */
function pacedFetch(delaySec: number): E.EngineFetch {
  let last = 0;
  return async (r) => {
    const wait = last + delaySec * 1000 - Date.now();
    if (wait > 0) await new Promise((res) => setTimeout(res, wait));
    last = Date.now();
    return oxyFetch(r);
  };
}

export async function handleList(request: Request): Promise<Response> {
  if (request.method !== 'POST') return Response.json({ error: 'POST required' }, { status: 405 });
  const workerKey = process.env['DISCO_WORKER_KEY'];
  if (!workerKey || request.headers.get('x-disco-worker-key') !== workerKey) return Response.json({ error: 'unauthorized' }, { status: 401 });
  let body: Body;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const domain = String(body.domain ?? '').toLowerCase();
  const gcid = String(body.gcid ?? '');
  const frontier_id = body.frontier_id ?? null;
  if (!domain || !gcid) return Response.json({ ok: false, frontier_id, reason: 'domain and gcid are required' }, { status: 400 });
  try {
    const route = body.dry_run === true && body.config && Array.isArray(body.config.sources)
      ? { config: { headers: {}, strip_query: false, render: false, ...body.config, domain }, delaySec: 3 }
      : await loadRoute(domain, gcid);
    if (!route) return Response.json({ ok: false, frontier_id, url: body.url ?? null, reason: 'no_list_route' });
    const collector = new E.Collector(route.config);
    const fetch = pacedFetch(route.delaySec);

    if (body.dry_run === true && body.full === true) {
      const started = Date.now();
      const stats = await E.runConfig(route.config, collector, {
        workers: 2, deadline: Date.now() + 780_000, maxPages: body.max_pages ? Number(body.max_pages) : undefined,
      }, fetch);
      return Response.json({
        dry_run: true, full: true, ok: true, domain, gcid, seconds: Math.round((Date.now() - started) / 1000),
        profile_urls: collector.seen.size, samples: [...collector.seen].slice(0, 20), sources: stats.map((s) => s.summary()),
      });
    }

    const url = String(body.url ?? '');
    const unit = decodeListUnit(url) ?? (body.dry_run ? { s: 0, k: 'root' as const } : null);
    if (!unit) return Response.json({ ok: false, frontier_id, url, reason: 'not_list_unit' });
    const res = await E.runListUnit(route.config, unit, collector, fetch, { pagesPerUnit: PAGES_PER_UNIT, deadline: Date.now() + UNIT_BUDGET_MS });
    const base = route.config.start_url;
    const urls = [...collector.seen];
    const summary = res.stats.summary();
    const blocked = res.stats.blocked > 0 && !urls.length && !res.next.length;
    return Response.json({
      ok: !blocked, frontier_id, url, dry_run: body.dry_run === true || undefined,
      reason: blocked ? 'blocked' : res.reason, unit,
      profile_urls: urls, next_units: res.next.map((u) => encodeListUnit(base, u)),
      stats: { requests: summary.requests, found: summary.profile_urls_found, rejected: summary.rejected_by_profile_pattern, errors: summary.errors },
    });
  } catch (e) {
    return Response.json({ ok: false, frontier_id, url: body.url ?? null, reason: 'error', error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}

export const Route = createFileRoute('/api/public/disco-list-worker')({
  server: { handlers: { POST: ({ request }) => handleList(request) } },
});
