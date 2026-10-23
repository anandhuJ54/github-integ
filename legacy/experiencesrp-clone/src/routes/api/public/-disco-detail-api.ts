// ============================================================================
// Detail route (2026-10-14): a profile API for one profile at a time.
// The leading dash in the file name keeps it out of the file router.
//
// After site mapper version 2 has proven how profiles are listed, this module checks whether the site
// also serves each profile's data through its own API (a background call the profile page makes), and
// learns a field map from that JSON. Evidence only:
//   - probeDetailApi opens up to 2 sample profile pages in the remote browser and keeps a captured call
//     only when it is on the site itself, returns JSON with this profile's id or name words, and its
//     request carries the profile's id or slug (so a URL template can be built). The call is then
//     replayed outside the browser (no cookies, no login / session / token headers) for 3 different
//     profiles and must return each profile's own data, not another profile's.
//   - learnJsonFields asks the AI once which JSON path holds each field id; code keeps a path only when
//     it gives a value on at least half of the fetched profiles (and a plausible value for phone, email,
//     url fields). The counts are measured on real responses.
// Nothing here writes to the database.
// ============================================================================
import { captureNetworkCalls, fetchApiCall } from './disco-webscraper-worker';
import { normalizeCapturedCalls, parseJsonLoose, replayHeaders, isNoiseCall, type CapturedCall } from './-disco-network-route';
import { jsonpath, siteDomain, hostOf } from './-disco-agent-engine';
import { fieldType } from './-disco-site-contract';

export type DetailToken = { kind: 'id' | 'slug'; seg_from_end: number; seg_pattern: string };
export type DetailApi = {
  method: 'GET' | 'POST'; url_template: string; body_template: string | null; headers: Record<string, string>; token: DetailToken;
};
export type DetailCheck = { profile_url: string; api_url?: string; ok: boolean; why: string };
export type DetailProbe = {
  status: 'proven' | 'none' | 'error'; reason: string; api?: DetailApi; proven_on: DetailCheck[];
  checked: Array<{ url: string; why: string }>; captures: number; ms: number;
};
export type JsonFieldMap = {
  fields: Record<string, string>; per_item: number[]; median: number; items: number;
  must_have_share: number; dropped: Array<{ id: string; path: string; why: string }>; sample?: unknown;
  /** Share of the fetched profiles with a value, per kept field (coverage, not a reason to drop). */
  fill?: Record<string, number>;
};
export type DetailRouteResult = { probe: DetailProbe; json?: JsonFieldMap; error?: string; ms: number };

// ---- profile tokens ------------------------------------------------------------------
type Tokens = { id: string | null; slug: string | null; words: string[] };
function segments(u: string): string[] {
  try { return new URL(u).pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s)); } catch { return []; }
}
export function profileTokens(u: string): Tokens {
  const segs = segments(u);
  let id: string | null = null;
  for (let i = segs.length - 1; i >= 0 && !id; i--) { const m = /(\d{4,})/.exec(segs[i]); if (m) id = m[1]; }
  let slug: string | null = null;
  let words: string[] = [];
  // The name slug is the segment nearest the end with 2+ words and no long number (e.g. /agents/jane-doe/12345).
  for (let i = segs.length - 1; i >= 0 && !slug; i--) {
    const w = segs[i].toLowerCase().split(/[-_.]+/).filter((x) => /^[a-z]{2,}$/.test(x));
    if (w.length >= 2 && !/\d{4,}/.test(segs[i])) { slug = segs[i]; words = w; }
  }
  return { id, slug, words };
}
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function tokenSpec(profileUrl: string, kind: 'id' | 'slug', value: string): DetailToken | null {
  const segs = segments(profileUrl);
  for (let i = segs.length - 1; i >= 0; i--) {
    const at = segs[i].toLowerCase().indexOf(value.toLowerCase());
    if (at < 0) continue;
    const pre = segs[i].slice(0, at);
    const post = segs[i].slice(at + value.length);
    const group = kind === 'id' ? '(\\d+)' : pre || post ? '([a-z0-9-]+)' : '([^/]+)';
    return { kind, seg_from_end: segs.length - i, seg_pattern: `${reEsc(pre)}${group}${reEsc(post)}` };
  }
  return null;
}
export function tokenFrom(profileUrl: string, t: DetailToken): string | null {
  const segs = segments(profileUrl);
  const seg = segs[segs.length - t.seg_from_end];
  if (!seg) return null;
  try { const m = new RegExp(`^${t.seg_pattern}$`, 'i').exec(seg); return m?.[1] ?? null; } catch { return null; }
}
export function buildDetailCall(api: DetailApi, profileUrl: string): { url: string; body: string | null } | null {
  const tok = tokenFrom(profileUrl, api.token);
  if (!tok) return null;
  const enc = encodeURIComponent(tok);
  return { url: api.url_template.split('{token}').join(enc), body: api.body_template == null ? null : api.body_template.split('{token}').join(tok) };
}

// ---- evidence checks -------------------------------------------------------------------
function holds(text: string, t: Tokens): boolean {
  const low = text.toLowerCase();
  if (t.id && low.includes(t.id)) return true;
  return t.words.length >= 2 && t.words.every((w) => low.includes(w));
}
function maxObjectArray(v: unknown, depth = 0): number {
  if (depth > 6 || !v || typeof v !== 'object') return 0;
  if (Array.isArray(v)) {
    const own = v.filter((x) => x && typeof x === 'object' && !Array.isArray(x)).length;
    return Math.max(own, ...v.slice(0, 50).map((x) => maxObjectArray(x, depth + 1)));
  }
  return Math.max(0, ...Object.values(v as Record<string, unknown>).map((x) => maxObjectArray(x, depth + 1)));
}
const LIST_LIMIT = 25;

// ---- probe ---------------------------------------------------------------------------------
export async function probeDetailApi(opts: { domain: string; profileUrls: string[]; deadlineAt: number }): Promise<DetailProbe> {
  const started = Date.now();
  const left = () => opts.deadlineAt - Date.now();
  const site = siteDomain(opts.domain.replace(/^www\./, ''));
  const onSite = (u: string) => { const h = hostOf(u); return !!h && (h === site || h.endsWith(`.${site}`)); };
  const pool = [...new Set(opts.profileUrls)].filter((u) => onSite(u)).map((u) => ({ u, t: profileTokens(u) })).filter((x) => x.t.id || x.t.words.length >= 2);
  const checked: Array<{ url: string; why: string }> = [];
  const out: DetailProbe = { status: 'none', reason: '', proven_on: [], checked, captures: 0, ms: 0 };
  if (pool.length < 3) { out.reason = `fewer than 3 profile pages with an id or name in the URL (${pool.length})`; out.ms = Date.now() - started; return out; }
  type Cand = { call: CapturedCall; kind: 'id' | 'slug'; value: string; size: number; from: string };
  const cands: Cand[] = [];
  // Fix (capture robustness, 2026-10-14): bhhs.com dry run 64461 lost both captures (Oxylabs result 613, then a
  // 70 s abort). Two profile pages are now captured at the same time with up to 100 s each, and a third page is
  // tried when both fail and time is left; the reason says when every capture failed.
  let failedCaptures = 0;
  const readCapture = (p: { u: string; t: Tokens }, res: any) => {
    if (!res?.ok) { failedCaptures++; checked.push({ url: p.u, why: `capture failed: ${String(res?.error ?? '').slice(0, 120)}` }); return; }
    for (const c of normalizeCapturedCalls(res.content)) {
      if (isNoiseCall(c.url)) continue;
      if (!onSite(c.url)) { checked.push({ url: c.url, why: 'other domain (site-only rule)' }); continue; }
      if (!c.response_body) continue;
      const json = parseJsonLoose(c.response_body);
      if (json === undefined) continue;
      if (!holds(c.response_body, p.t)) { checked.push({ url: c.url, why: 'JSON without this profile' }); continue; }
      if (maxObjectArray(json) > LIST_LIMIT) { checked.push({ url: c.url, why: 'looks like a list' }); continue; }
      const req = `${c.url}\n${c.request_payload ?? ''}`.toLowerCase();
      const kind: 'id' | 'slug' | null = p.t.id && req.includes(p.t.id) ? 'id' : p.t.slug && req.includes(p.t.slug.toLowerCase()) ? 'slug' : null;
      if (!kind) { checked.push({ url: c.url, why: 'request does not carry the profile id or slug' }); continue; }
      cands.push({ call: c, kind, value: kind === 'id' ? p.t.id! : p.t.slug!, size: c.response_body.length, from: p.u });
    }
  };
  const capture = (p: { u: string; t: Tokens }) => captureNetworkCalls(p.u, { timeoutMs: Math.max(20_000, Math.min(100_000, left() - 40_000)), scroll: false })
    .catch((e) => ({ ok: false, content: null, error: String(e) } as any));
  if (left() >= 60_000) {
    const first = pool.slice(0, 2);
    out.captures += first.length;
    const res = await Promise.all(first.map((p) => capture(p)));
    first.forEach((p, i) => readCapture(p, res[i]));
    if (!cands.length && failedCaptures === first.length && pool[2] && left() >= 80_000) {
      out.captures++;
      readCapture(pool[2], await capture(pool[2]));
    }
  }
  if (!cands.length) {
    out.reason = !out.captures ? 'time budget (no capture)'
      : failedCaptures === out.captures ? `capture failed on all ${out.captures} profile pages (inconclusive)`
      : 'no captured call returned this profile\'s data with its id or slug in the request';
    out.ms = Date.now() - started; return out;
  }
  cands.sort((a, b) => b.size - a.size);
  for (const c of cands.slice(0, 2)) {
    const token = tokenSpec(c.from, c.kind, c.value);
    if (!token) continue;
    const re = new RegExp(reEsc(c.value), 'gi');
    const method: 'GET' | 'POST' = c.call.method === 'POST' ? 'POST' : 'GET';
    const api: DetailApi = {
      method, url_template: c.call.url.replace(re, '{token}'),
      body_template: method === 'POST' ? (c.call.request_payload ?? '').replace(re, '{token}') : null,
      headers: replayHeaders(c.call.request_headers), token,
    };
    if (!api.url_template.includes('{token}') && !(api.body_template ?? '').includes('{token}')) continue;
    const set = [pool.find((x) => x.u === c.from)!, ...pool.filter((x) => x.u !== c.from)].slice(0, 3);
    if (left() < 15_000) break;
    const checks = await Promise.all(set.map(async (p): Promise<DetailCheck> => {
      const call = buildDetailCall(api, p.u);
      if (!call) return { profile_url: p.u, ok: false, why: 'token not found in this profile URL' };
      const r = await fetchApiCall({ url: call.url, method, headers: api.headers, body: call.body, crawl_method: 'server_crawl', timeoutMs: Math.max(5_000, Math.min(30_000, left() - 5_000)) })
        .catch((e) => ({ ok: false, status_code: null, content: null, ms: 0, error: String(e) }));
      if (!r.ok || !r.content) return { profile_url: p.u, api_url: call.url, ok: false, why: `replay failed (${r.status_code ?? r.error ?? 'no response'})` };
      if (parseJsonLoose(r.content) === undefined) return { profile_url: p.u, api_url: call.url, ok: false, why: 'replay is not JSON' };
      if (!holds(r.content, p.t)) return { profile_url: p.u, api_url: call.url, ok: false, why: 'replay without this profile\'s data' };
      const other = set.find((q) => q.u !== p.u && q.t.words.length >= 2 && holds(r.content!, { id: null, slug: null, words: q.t.words }));
      if (other) return { profile_url: p.u, api_url: call.url, ok: false, why: `replay also holds another profile (${other.u})` };
      return { profile_url: p.u, api_url: call.url, ok: true, why: 'returns this profile' };
    }));
    out.proven_on = checks;
    if (checks.length >= 3 && checks.every((x) => x.ok)) {
      out.status = 'proven'; out.api = api; out.reason = `replayed for ${checks.length} profiles without cookies or login`;
      out.ms = Date.now() - started; return out;
    }
  }
  out.reason = 'a profile call was captured but did not replay for 3 profiles';
  out.ms = Date.now() - started;
  return out;
}

export async function fetchDetailJson(api: DetailApi, profileUrl: string, timeoutMs: number): Promise<unknown | undefined> {
  const call = buildDetailCall(api, profileUrl);
  if (!call) return undefined;
  const r = await fetchApiCall({ url: call.url, method: api.method, headers: api.headers, body: call.body, crawl_method: 'server_crawl', timeoutMs }).catch(() => null);
  if (!r?.ok || !r.content || !holds(r.content, profileTokens(profileUrl))) return undefined;
  return parseJsonLoose(r.content);
}

// ---- JSON field map -----------------------------------------------------------------------
function trimJson(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return v.length > 160 ? `${v.slice(0, 160)}…` : v;
  if (!v || typeof v !== 'object' || depth > 7) return v;
  if (Array.isArray(v)) return v.slice(0, 3).map((x) => trimJson(x, depth + 1));
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).slice(0, 80).map(([k, x]) => [k, trimJson(x, depth + 1)]));
}
function leafValues(nodes: unknown[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (n == null) continue;
    if (typeof n === 'string') { if (n.trim()) out.push(n.trim()); }
    else if (typeof n === 'number' || typeof n === 'boolean') out.push(String(n));
    else if (Array.isArray(n)) out.push(...leafValues(n));
  }
  return out;
}
function plausible(id: string, vals: string[]): boolean {
  const k = id.split('.')[1] ?? id;
  if (/email/.test(k)) return vals.some((v) => /@/.test(v));
  if (/phone|fax|mobile/.test(k)) return vals.some((v) => v.replace(/\D/g, '').length >= 7);
  if (/url|website|photo|image|logo|link/.test(k)) return vals.some((v) => /^(https?:)?\/\/|^\/|^www\./i.test(v));
  return true;
}
export const JSON_FIELDS_TOOL = {
  name: 'return_json_field_map',
  description: 'Map our field ids to JSON paths in the profile API response.',
  input_schema: {
    type: 'object',
    properties: {
      fields: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'One of our field ids, exactly as listed' },
            path: { type: 'string', description: 'JSONPath from the response root, e.g. $.data.agent.phone or $.agent.languages[*].name' },
          },
          required: ['id', 'path'],
        },
      },
    },
    required: ['fields'],
  },
} as const;

// Fix (sparse fields, 2026-10-14): bhhs.com request 155 lost bio and languages (the AI saw only 2 of the 12
// responses, neither had them) and licence, credentials, website and team (kept only with values on half the
// profiles). A field that only some profiles fill is still a correct field. The AI now sees an inventory of every
// key path across all fetched responses (how many profiles have a value, example values), and a path is kept when
// it gives a plausible value on at least 2 profiles and feeds one field only. Coverage is recorded per field (fill).
type PathInfo = { count: number; examples: string[] };
function pathInventory(items: unknown[]): Map<string, PathInfo> {
  const inv = new Map<string, PathInfo>();
  for (const json of items) {
    const seen = new Map<string, string>();
    const walk = (v: unknown, path: string, depth: number) => {
      if (depth > 7 || v == null) return;
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        const t = String(v).trim();
        if (t && !seen.has(path)) seen.set(path, t.length > 80 ? `${t.slice(0, 80)}…` : t);
        return;
      }
      if (Array.isArray(v)) { for (const x of v.slice(0, 20)) walk(x, `${path}[*]`, depth + 1); return; }
      if (typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 120)) walk(x, /^[A-Za-z_$][\w$]*$/.test(k) ? `${path}.${k}` : `${path}['${k.replace(/'/g, '')}']`, depth + 1);
    };
    walk(json, '$', 0);
    for (const [p, ex] of seen) {
      const e = inv.get(p) ?? { count: 0, examples: [] };
      e.count++;
      if (e.examples.length < 3 && !e.examples.includes(ex)) e.examples.push(ex);
      inv.set(p, e);
    }
  }
  return inv;
}

export async function learnJsonFields(args: {
  items: Array<{ profile_url: string; json: unknown }>;
  fieldIds: string[];
  meanings: Record<string, string>;
  ask: (prompt: string) => Promise<any>;
  mustHave: (values: Record<string, unknown>) => boolean;
}): Promise<JsonFieldMap> {
  const items = args.items.filter((x) => x.json !== undefined);
  const inv = [...pathInventory(items.map((x) => x.json)).entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 300);
  const invText = inv.map(([p, e]) => `${p}  (${e.count} of ${items.length}): ${e.examples.join(' | ')}`).join('\n').slice(0, 24_000);
  // Fix (timezone, 2026-10-14): timezone ids are not offered (bhhs.com mapped location.timezone to the agent's
  // lead-notification preference, which is not the office's timezone).
  const offered = args.fieldIds.filter((id) => !/\.(profile_url|timezone)$/.test(id));
  const prompt =
    `These are key paths found in a website's own API responses for ${items.length} single professional profiles, ` +
    `with how many profiles have a value there and example values. Map each of our field ids that these responses hold ` +
    `to one JSONPath (copy a path from the list; [*] means every item of a list). A field that only some profiles have ` +
    `is still a field: map it. Only map a field when the path really holds that information about this profile; ` +
    `leave the rest out. Use each path for one field id only.\n\n` +
    `OUR FIELD IDS:\n${offered.map((id) => `${id}${args.meanings[id] ? ` — ${args.meanings[id]}` : ''}`).join('\n')}\n\n` +
    `KEY PATHS:\n${invText}`;
  const res = await args.ask(prompt);
  const proposed: Array<{ id: string; path: string }> = Array.isArray(res?.fields) ? res.fields.filter((f: any) => typeof f?.id === 'string' && typeof f?.path === 'string') : [];
  // Fix (profile URL, 2026-10-14): the profile URL is always the page URL, never a JSON value.
  const allowed = new Set(offered);
  const need = Math.min(2, items.length);
  const fields: Record<string, string> = {};
  const fill: Record<string, number> = {};
  const usedPath = new Map<string, string>();
  const dropped: JsonFieldMap['dropped'] = [];
  for (const f of proposed) {
    if (!allowed.has(f.id)) { dropped.push({ ...f, why: 'unknown field id' }); continue; }
    if (fields[f.id]) continue;
    if (usedPath.has(f.path)) { dropped.push({ ...f, why: `path already used for ${usedPath.get(f.path)}` }); continue; }
    let hits = 0; let ok = true;
    const all: string[] = [];
    for (const it of items) {
      let vals: string[] = [];
      try { vals = leafValues(jsonpath(it.json, f.path)); } catch { ok = false; break; }
      if (vals.length) { hits++; all.push(...vals.slice(0, 3)); }
    }
    if (!ok) { dropped.push({ ...f, why: 'path not supported' }); continue; }
    if (hits < need) { dropped.push({ ...f, why: `value on ${hits} of ${items.length} profiles` }); continue; }
    if (!plausible(f.id, all)) { dropped.push({ ...f, why: 'values do not look like this field' }); continue; }
    fields[f.id] = f.path;
    usedPath.set(f.path, f.id);
    fill[f.id] = Math.round((hits / Math.max(1, items.length)) * 100) / 100;
  }
  const valuesOf = (json: unknown) => jsonValues(json, fields);
  const per = items.map((it) => Object.keys(valuesOf(it.json)).length);
  const sorted = [...per].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const mh = items.length ? items.filter((it) => args.mustHave(valuesOf(it.json))).length / items.length : 0;
  return { fields, per_item: per, median, items: items.length, must_have_share: Math.round(mh * 100) / 100, dropped, fill, sample: items[0] ? trimJson(items[0].json) : undefined };
}

/** Field values of one profile API response with a learned JSON field map (one value, or a list for several). */
export function jsonValues(json: unknown, fields: Record<string, string>): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  for (const [id, path] of Object.entries(fields ?? {})) {
    if (/\.profile_url$/.test(id)) continue;
    try {
      const vals = leafValues(jsonpath(json, path));
      // A [*] path can give several values; only list fields keep them all.
      if (vals.length) v[id] = vals.length === 1 || fieldType(id) !== 'list' ? vals[0] : vals;
    } catch { /* skip */ }
  }
  return v;
}

/** The profile API call for one profile URL, fetched and checked (it must hold this profile's id or name). */
export async function fetchDetailFor(api: DetailApi, profileUrl: string, timeoutMs: number): Promise<{ json?: unknown; why: string; api_url?: string }> {
  const call = buildDetailCall(api, profileUrl);
  if (!call) return { why: 'profile id / slug not found in the URL' };
  const r = await fetchApiCall({ url: call.url, method: api.method, headers: api.headers, body: call.body, crawl_method: 'server_crawl', timeoutMs }).catch((e) => ({ ok: false, status_code: null, content: null, ms: 0, error: String(e) }));
  if (!r.ok || !r.content) return { why: `api call failed (${r.status_code ?? r.error ?? 'no response'})`, api_url: call.url };
  const json = parseJsonLoose(r.content);
  if (json === undefined) return { why: 'api reply is not JSON', api_url: call.url };
  if (!holds(r.content, profileTokens(profileUrl))) return { why: "api reply without this profile's id or name", api_url: call.url };
  return { json, why: 'ok', api_url: call.url };
}
