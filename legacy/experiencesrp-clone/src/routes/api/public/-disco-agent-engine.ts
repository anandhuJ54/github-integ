// ============================================================================
// disco agent engine — site mapper version 2 (AI agent), crawler engine (2026-10-09).
//
// The no-AI part of version 2: runs a crawler config ("sources") and collects profile URLs.
// Used while mapping to test a method on a small sample (test_source), to measure coverage
// (coverage_check) and to validate a submitted config. Ported from the standalone AutoCrawl tool
// (main.py, sections 1-5) to TypeScript; the network layer is injected (Oxylabs Web Scraper API in
// the worker), so this file has no network or database code of its own.
//
// Source types: sitemap, listing (page / offset / cursor / next_link paging, looped over seeds:
// list, range, alphabet with automatic deepening, us_states, extract incl. dependent extract seeds),
// link_crawl, autocomplete. Extractors: html (CSS with ::attr(x) / ::text), json (JSONPath subset),
// embedded_json (script tag or regex), header.
//
// The leading dash in the file name keeps it out of the file router.
// ============================================================================
import { load } from 'cheerio/slim';

// ---- network interface (injected) -------------------------------------------------------
export type EngineRequest = {
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  body?: string | null;
  render?: boolean;
  maxBytes?: number;
  timeoutMs: number;
};
export type EngineResponse = { url: string; status: number; text: string; blocked: boolean; truncated: boolean; error?: string; ms: number };
export type EngineFetch = (r: EngineRequest) => Promise<EngineResponse>;

export const SOURCE_TYPES = ['listing', 'sitemap', 'autocomplete', 'link_crawl'] as const;
export const LOC_RE = /<loc>\s*(?:<!\[CDATA\[)?\s*(.*?)\s*(?:\]\]>)?\s*<\/loc>/gis;
const ID_SEGMENT = /^(?:[0-9a-f]{24}|[0-9a-f]{8}-[0-9a-f-]{27,}|\d+|(?=.*\d)[A-Za-z0-9_-]{16,})$/i;
export const US_STATES: Array<[string, string]> = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'], ['CO', 'Colorado'],
  ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'],
  ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'],
  ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'],
  ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'],
  ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'],
  ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'],
  ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
];

export class ConfigError extends Error {}

// ---- small helpers ----------------------------------------------------------------------
export function clip(text: string | null | undefined, limit: number): string | null {
  if (text == null) return null;
  return text.length <= limit ? text : `${text.slice(0, limit)}… [${text.length - limit} more chars]`;
}
export function parseJson(text: string | null | undefined): any {
  if (!text) return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
}
export function siteDomain(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, '');
  const parts = h.split('.');
  if (parts.length > 2 && parts[parts.length - 2].length <= 3 && parts[parts.length - 1].length <= 2) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}
export function hostOf(u: string): string {
  try { return new URL(u).hostname.toLowerCase(); } catch { return ''; }
}
export function resolveUrl(href: string, base: string): string {
  try { return new URL(href, base).toString(); } catch { return href; }
}
function htmlUnescape(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'");
}

// ---- JSONPath subset: $ .key ['key'] [n] [*] .* [a:b] ..key ------------------------------
const TOKEN = /\.\.([A-Za-z_$][\w$-]*)|\.([A-Za-z_$][\w$-]*)|\[\s*'([^']*)'\s*\]|\[\s*"([^"]*)"\s*\]|\[\s*(\*|-?\d+)\s*\]|\.\*|\[\s*(-?\d*)\s*:\s*(-?\d*)\s*\]/y;
function* descend(node: any): Generator<any> {
  yield node;
  const kids = Array.isArray(node) ? node : node && typeof node === 'object' ? Object.values(node) : [];
  for (const k of kids) yield* descend(k);
}
export function jsonpath(data: any, path: string): any[] {
  let p = path.trim();
  if (!p.startsWith('$')) p = `$.${p}`;
  let nodes: any[] = [data];
  let pos = 1;
  while (pos < p.length) {
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(p);
    if (!m || m.index !== pos) throw new Error(`Unsupported JSONPath syntax at ${JSON.stringify(p.slice(pos))} in ${JSON.stringify(p)}`);
    pos = TOKEN.lastIndex;
    const [whole, recursive, key, q1, q2, idx, lo, hi] = m;
    if (lo !== undefined || hi !== undefined) {
      const a = lo ? Number(lo) : undefined;
      const b = hi ? Number(hi) : undefined;
      nodes = nodes.flatMap((n) => (Array.isArray(n) ? n.slice(a, b) : []));
    } else if (recursive) {
      nodes = nodes.flatMap((n) => [...descend(n)].filter((d) => d && typeof d === 'object' && !Array.isArray(d) && recursive in d).map((d) => d[recursive]));
    } else if (key !== undefined || q1 !== undefined || q2 !== undefined) {
      const k = (key ?? q1 ?? q2)!;
      nodes = nodes.filter((n) => n && typeof n === 'object' && !Array.isArray(n) && k in n).map((n) => n[k]);
    } else if (idx === '*' || whole === '.*') {
      nodes = nodes.flatMap((n) => (Array.isArray(n) ? n : n && typeof n === 'object' ? Object.values(n) : []));
    } else {
      const i = Number(idx);
      nodes = nodes.filter((n) => Array.isArray(n) && i >= -n.length && i < n.length).map((n) => n[i < 0 ? n.length + i : i]);
    }
  }
  return nodes;
}

// ---- templates --------------------------------------------------------------------------
const VAR = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
export function renderTemplate(value: any, vars: Record<string, any>): any {
  if (typeof value === 'string') {
    const whole = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value);
    if (whole && whole[1] in vars) return vars[whole[1]];
    return value.replace(VAR, (m, k) => (k in vars ? String(vars[k]) : m));
  }
  if (Array.isArray(value)) return value.map((v) => renderTemplate(v, vars));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renderTemplate(v, vars)]));
  return value;
}
export function unresolved(value: any): string[] {
  const s = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return [...new Set([...s.matchAll(VAR)].map((m) => m[1]))].sort();
}

// ---- extractors -------------------------------------------------------------------------
/** parsel-style CSS: "a.card::attr(href)", "h1::text"; a plain selector gives each element's HTML. */
export function cssValues(html: string, css: string): string[] {
  const attrM = /::attr\(([^)]+)\)\s*$/.exec(css);
  const wantText = /::text\s*$/.test(css);
  const sel = css.replace(/::attr\([^)]+\)\s*$/, '').replace(/::text\s*$/, '').trim() || '*';
  const $ = load(html);
  const out: string[] = [];
  $(sel).each((_, el) => {
    const e = $(el);
    if (attrM) { const v = e.attr(attrM[1].trim()); if (v != null) out.push(v); }
    else if (wantText) out.push(e.text());
    else out.push($.html(el) ?? '');
  });
  return out;
}
export function embeddedJson(html: string, css?: string | null, regex?: string | null): any {
  if (regex) {
    const m = new RegExp(regex, 's').exec(html);
    return m ? parseJson(m[1] ?? m[0]) : undefined;
  }
  return parseJson(cssValues(html, css || 'script#__NEXT_DATA__::text')[0]);
}
export type Extractor = { source?: string; css?: string; xpath?: string; path?: string; embedded_css?: string; embedded_regex?: string; name?: string; regex?: string; url_template?: string };
const looksJson = (t: string) => { const s = (t ?? '').trimStart(); return s.startsWith('{') || s.startsWith('['); };
export function extract(spec: Extractor, text: string, baseUrl?: string, headers?: Record<string, string>): string[] {
  const source = spec?.source ?? 'html';
  let values: any[] = [];
  if (source === 'html') {
    if (spec.xpath) throw new ConfigError('xpath extractors are not supported here; use css');
    if (spec.css && !looksJson(text)) values = cssValues(text ?? '', spec.css);
  } else if (source === 'json' || source === 'embedded_json') {
    const data = source === 'json' ? parseJson(text) : embeddedJson(text ?? '', spec.embedded_css, spec.embedded_regex);
    values = data !== undefined && spec.path ? jsonpath(data, spec.path) : [];
  } else if (source === 'header') {
    values = Object.entries(headers ?? {}).filter(([k]) => k.toLowerCase() === (spec.name ?? '').toLowerCase()).map(([, v]) => v);
  }
  const out: string[] = [];
  for (const v of values) {
    if (v == null || typeof v === 'object') continue;
    let s = String(v).trim();
    if (spec.regex) {
      const m = new RegExp(spec.regex).exec(s);
      if (!m) continue;
      s = m[1] ?? m[0];
    }
    if (!s) continue;
    if (spec.url_template) s = spec.url_template.replace('{value}', s);
    if (baseUrl && !/^[a-z][a-z0-9+.-]*:/i.test(s) && (/^(\/|\.\/|\.\.\/|\?)/.test(s) || s.includes('/'))) s = resolveUrl(s, baseUrl);
    out.push(s);
  }
  return out;
}

// ---- summaries shown to the AI ------------------------------------------------------------
export function trimJson(obj: any, maxStr = 120, maxList = 2, depth = 7): any {
  if (depth <= 0) return '…';
  if (Array.isArray(obj)) {
    const items = obj.slice(0, maxList).map((v) => trimJson(v, maxStr, maxList, depth - 1));
    return obj.length > maxList ? [...items, `… ${obj.length - maxList} more`] : items;
  }
  if (obj && typeof obj === 'object') return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, trimJson(v, maxStr, maxList, depth - 1)]));
  return typeof obj === 'string' && obj.length > maxStr ? `${obj.slice(0, maxStr)}…` : obj;
}
function* walkJson(data: any, path = '$'): Generator<[string, any]> {
  yield [path, data];
  if (Array.isArray(data)) {
    for (let i = 0; i < data.length; i++) yield* walkJson(data[i], `${path}[${i}]`);
  } else if (data && typeof data === 'object') {
    for (const [k, v] of Object.entries(data)) yield* walkJson(v, path + (/^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `['${k}']`));
  }
}
export function findLists(data: any, minLen = 3, limit = 6): any[] {
  const found: any[] = [];
  const seen = new Set<string>();
  const parents = new Map<string, any>();
  let steps = 0;
  for (const [path, node] of walkJson(data)) {
    if (++steps > 50_000) break;
    if (node && typeof node === 'object' && !Array.isArray(node)) parents.set(path, node);
    if (!(Array.isArray(node) && node.length >= minLen && node.slice(0, 5).every((i) => i && typeof i === 'object' && !Array.isArray(i)))) continue;
    const gpath = path.replace(/\[\d+\]/g, '[*]');
    if (seen.has(gpath)) continue;
    seen.add(gpath);
    const parentPath = path.includes('.') ? path.slice(0, path.lastIndexOf('.')) : '$';
    const parent = parents.get(parentPath) ?? {};
    const counters = Object.fromEntries(Object.entries(parent).filter(([, v]) => typeof v === 'number').slice(0, 10));
    found.push({ path: `${gpath}[*]`, length: node.length, item_keys: Object.keys(node[0]).slice(0, 25), sample_item: trimJson(node[0], 90, 2, 4), numeric_siblings: counters });
  }
  return found.sort((a, b) => b.length - a.length).slice(0, limit);
}
export function urlPattern(url: string): string {
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').map((seg) => (/^(pg|page)-\d+$/i.test(seg) ? seg.replace(/\d+/g, '{n}') : ID_SEGMENT.test(seg) ? '{id}' : seg));
    const q = [...new Set(u.search.slice(1).split('&').filter(Boolean).map((kv) => `${kv.split('=')[0]}=`))].sort().join('&');
    return `${u.host}${segs.join('/')}${q ? `?${q}` : ''}`;
  } catch { return url; }
}
export function summarizeHtml(html: string, pageUrl: string): Record<string, unknown> {
  // Fix (v2 CPU, 2026-10-09): a page summary reads at most the first 1 MB (kw.com dry run 3979 stopped
  // with the platform's CPU-limit error 1102); extraction itself still reads whole pages.
  const $ = load(html.length > 1_000_000 ? html.slice(0, 1_000_000) : html);
  const site = siteDomain(hostOf(pageUrl));
  const blobs: any[] = [];
  $('script[type="application/json"], script#__NEXT_DATA__').each((_, el) => {
    if (blobs.length >= 6) return;
    const data = parseJson($(el).text());
    if (data !== undefined) {
      const id = $(el).attr('id');
      blobs.push({ embedded_css: id ? `script#${id}::text` : 'script[type="application/json"]::text', top_keys: data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data).slice(0, 15) : typeof data, lists: findLists(data) });
    }
  });
  for (const m of html.slice(0, 1_000_000).matchAll(/window\.(__[A-Za-z0-9_]+__)\s*=\s*(\{.*?\})\s*;?\s*<\/script>/gs)) {
    if (blobs.length >= 6) break;
    const data = parseJson(m[2]);
    if (data !== undefined) blobs.push({ embedded_regex: `window\\.${m[1]}\\s*=\\s*(\\{.*?\\})\\s*;?\\s*</script>`, lists: findLists(data) });
  }
  const patterns = new Map<string, { pattern: string; count: number; examples: string[]; css: Map<string, number> }>();
  const pagination: Array<{ href: string; text: string }> = [];
  const name = (e: any) => {
    const tag = String(e.prop('tagName') ?? '').toLowerCase();
    const tid = e.attr('data-testid');
    if (tid) return `${tag}[data-testid="${tid}"]`;
    const cls = String(e.attr('class') ?? '').split(/\s+/).filter(Boolean)[0];
    return tag + (cls ? `.${cls}` : '');
  };
  $('a[href]').each((_, el) => {
    const a = $(el);
    const href = (a.attr('href') ?? '').trim();
    if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) return;
    const abs = resolveUrl(href, pageUrl);
    if (!hostOf(abs).endsWith(site)) return;
    const text = a.text().replace(/\s+/g, ' ').trim().slice(0, 50);
    const pat = urlPattern(abs);
    const entry = patterns.get(pat) ?? { pattern: pat, count: 0, examples: [], css: new Map<string, number>() };
    entry.count++;
    if (entry.examples.length < 2) entry.examples.push(abs);
    const parent = a.parent();
    const hint = parent.length ? `${name(parent)} > ${name(a)}` : name(a);
    entry.css.set(hint, (entry.css.get(hint) ?? 0) + 1);
    patterns.set(pat, entry);
    const label = a.attr('aria-label') ?? '';
    if (/\bnext\b/.test(a.attr('rel') ?? '') || /^(\d{1,4}|next|›|»|>)$/i.test(text) || /page|next/i.test(label)
      || /(?:^|[/_-])(?:pg|page)[-/]\d+|[?&](?:page|pg|p|offset|start|from|skip|cursor)=/i.test(abs)) {
      if (pagination.length < 8) pagination.push({ href: abs, text: text || label });
    }
  });
  const top = [...patterns.values()].sort((x, y) => y.count - x.count).slice(0, 10)
    .map((e) => ({ pattern: e.pattern, count: e.count, examples: e.examples, css_hints: [...e.css.entries()].sort((x, y) => y[1] - x[1]).slice(0, 1).map(([h]) => h) }));
  return { title: $('title').first().text().trim().slice(0, 120), embedded_json: blobs, link_patterns: top, pagination_links: pagination };
}
export function summarizeBody(url: string, contentType: string, text: string): Record<string, unknown> {
  const ctype = (contentType ?? '').toLowerCase();
  const stripped = (text ?? '').trimStart();
  if (ctype.includes('json') || looksJson(stripped)) {
    const data = parseJson(text);
    if (data !== undefined) return { kind: 'json', lists: findLists(data), shape: clip(JSON.stringify(trimJson(data, 120, 1, 6)), 2000) };
  }
  if (ctype.includes('xml') || stripped.startsWith('<?xml') || stripped.slice(0, 500).includes('<urlset') || stripped.slice(0, 500).includes('<sitemapindex')) {
    const locs = [...text.matchAll(LOC_RE)].map((m) => m[1]);
    return { kind: 'xml', loc_count: locs.length, first_locs: locs.slice(0, 8) };
  }
  if (ctype.includes('html') || stripped.slice(0, 1000).toLowerCase().includes('<html')) return { kind: 'html', ...summarizeHtml(text, url) };
  return { kind: 'text', excerpt: clip(text, 1200) };
}

// ---- config -----------------------------------------------------------------------------
export function normalizeConfig(config: any): { cfg: any; problems: string[] } {
  const cfg = { ...config };
  cfg.sources = Array.isArray(cfg.sources) ? cfg.sources : [];
  const problems: string[] = cfg.domain ? [] : ['domain is missing'];
  const regexes: Array<[string, any]> = [['profile_url_pattern', cfg.profile_url_pattern]];
  const names = new Set<string>();
  cfg.sources.forEach((src: any, i: number) => {
    const label = src?.name || `#${i + 1}`;
    if (names.has(label)) problems.push(`duplicate source name '${label}'`);
    names.add(label);
    if (!(SOURCE_TYPES as readonly string[]).includes(src?.type)) { problems.push(`source ${label}: unknown type '${src?.type}' (use one of ${SOURCE_TYPES.join(', ')})`); return; }
    const need: Record<string, string[]> = { listing: ['listing', 'pagination', 'items'], autocomplete: ['request', 'items'], link_crawl: ['start_urls'] };
    for (const k of need[src.type] ?? []) if (!src[k] && src[k] !== 0) problems.push(`source ${label} (${src.type}): '${k}' is required`);
    for (const k of ['url_filter', 'follow', 'include']) regexes.push([`source ${label}: ${k}`, src[k]]);
  });
  for (const [label, rx] of regexes) {
    if (rx) { try { new RegExp(rx); } catch (e) { problems.push(`${label} is not a valid regex: ${String(e).slice(0, 120)}`); } }
  }
  if (!cfg.sources.length) problems.push('no sources defined');
  return { cfg, problems };
}

// ---- seeds ------------------------------------------------------------------------------
type SeedExtractor = (spec: any, combo: Record<string, string>) => Promise<string[]>;
function product(chars: string, depth: number): string[] {
  let out = [''];
  for (let i = 0; i < depth; i++) out = out.flatMap((p) => [...chars].map((c) => p + c));
  return out;
}
export async function seedValues(spec: any, extractor?: (s: any) => Promise<string[]>): Promise<string[]> {
  let values: string[];
  switch (spec?.type) {
    case 'list': values = (spec.values ?? []).map(String); break;
    case 'range': {
      values = [];
      const step = Number(spec.step ?? 1) || 1;
      for (let n = Number(spec.start); n <= Number(spec.end) && values.length < 200_000; n += step) values.push(String(n).padStart(Number(spec.width ?? 0), '0'));
      break;
    }
    case 'alphabet': values = product(spec.chars || 'abcdefghijklmnopqrstuvwxyz', Number(spec.depth ?? 1)); break;
    case 'us_states': {
      const fmt = spec.format ?? 'abbr';
      values = US_STATES.map(([a, n]) => ({ abbr: a, abbr_lower: a.toLowerCase(), name: n, slug: n.toLowerCase().replace(/ /g, '-'), slug_underscore: n.toLowerCase().replace(/ /g, '_') } as Record<string, string>)[fmt] ?? a);
      break;
    }
    case 'extract': {
      if (!extractor) throw new ConfigError('extract seeds need a fetcher');
      const got = [...new Set(await extractor(spec))];
      values = spec.limit ? got.slice(0, Number(spec.limit)) : got;
      break;
    }
    default: throw new ConfigError(`unknown seed type '${spec?.type}'`);
  }
  return spec?.pad ? values.map((v) => v.padStart(Number(spec.pad), '0')) : values;
}
export async function seedCombinations(seeds: Record<string, any>, extractor: SeedExtractor | null, maxSeeds?: number): Promise<Array<Record<string, string>>> {
  let combos: Array<Record<string, string>> = [{}];
  for (const [name, spec] of Object.entries(seeds ?? {})) {
    const dependent = spec?.type === 'extract' && unresolved(spec.request ?? {}).some((v) => v in combos[0]);
    if (dependent) {
      if (maxSeeds) combos = combos.slice(0, maxSeeds);
      const next: Array<Record<string, string>> = [];
      for (const c of combos) {
        const vals = await seedValues(spec, extractor ? (s) => extractor(s, c) : undefined);
        for (const v of vals) next.push({ ...c, [name]: v });
        if (maxSeeds && next.length >= maxSeeds) break;
      }
      combos = next;
    } else {
      const vals = await seedValues(spec, extractor ? (s) => extractor(s, {}) : undefined);
      combos = combos.flatMap((c) => vals.map((v) => ({ ...c, [name]: v })));
      if (combos.length > 500_000) combos = combos.slice(0, 500_000);
    }
  }
  return maxSeeds ? combos.slice(0, maxSeeds) : combos;
}
export function adaptiveChildren(seeds: Record<string, any>, combo: Record<string, string>, itemsFound: number): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = [];
  for (const [name, spec] of Object.entries(seeds ?? {})) {
    if (spec?.type === 'alphabet' && spec.expand_at) {
      const value = combo[name] ?? '';
      if (itemsFound >= Number(spec.expand_at) && value.length < Number(spec.max_depth ?? 3)) {
        for (const c of spec.chars || 'abcdefghijklmnopqrstuvwxyz') out.push({ ...combo, [name]: value + c });
      }
    }
  }
  return out;
}

// ---- engine -----------------------------------------------------------------------------
export type Limits = { maxPages?: number; maxSeeds?: number; maxRequests?: number; workers: number; deadline?: number; sitemapBytes?: number };
const expired = (l: Limits) => l.deadline != null && Date.now() >= l.deadline;

export class SourceStats {
  requests = 0; found = 0; fresh = 0; rejected = 0; tasksDone = 0; tasksTotal = 0; blocked = 0; seconds = 0;
  samples: string[] = []; rejectedSamples: string[] = []; errors: string[] = []; log: string[] = []; notes: string[] = [];
  stopReasons = new Map<string, number>();
  constructor(public name: string, public type: string) {}
  stop(reason: string) { this.stopReasons.set(reason, (this.stopReasons.get(reason) ?? 0) + 1); }
  summary(): Record<string, any> {
    return {
      source: this.name, type: this.type, requests: this.requests, profile_urls_found: this.found, new_unique: this.fresh,
      rejected_by_profile_pattern: this.rejected, tasks_done: this.tasksDone, tasks_total: this.tasksTotal,
      stop_reasons: Object.fromEntries([...this.stopReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)),
      blocked_requests: this.blocked, errors: this.errors.slice(0, 4), sample_urls: this.samples.slice(0, 8),
      rejected_samples: this.rejectedSamples.slice(0, 4), seconds: Math.round(this.seconds * 10) / 10, notes: this.notes.slice(0, 4),
      request_log_tail: this.log.slice(-5),
    };
  }
}

export class Collector {
  pattern: RegExp | null;
  stripQuery: boolean;
  seen = new Set<string>();
  constructor(config: any) {
    this.pattern = config.profile_url_pattern ? new RegExp(config.profile_url_pattern) : null;
    this.stripQuery = !!config.strip_query;
  }
  normalize(url: string): string {
    try {
      const u = new URL(htmlUnescape(url.trim()));
      u.hash = '';
      if (this.stripQuery) u.search = '';
      return u.toString();
    } catch { return url.trim(); }
  }
  add(urls: string[], stats: SourceStats): string[] {
    const fresh: string[] = [];
    for (const raw of urls) {
      const url = this.normalize(raw);
      if (this.pattern && !this.pattern.test(url)) {
        stats.rejected++;
        if (stats.rejectedSamples.length < 8) stats.rejectedSamples.push(url);
        continue;
      }
      stats.found++;
      if (!this.seen.has(url)) {
        this.seen.add(url);
        fresh.push(url);
        if (stats.samples.length < 12) stats.samples.push(url);
      }
    }
    stats.fresh += fresh.length;
    return fresh;
  }
}

type Ctx = { cfg: any; fetch: EngineFetch; timeoutMs: number };
const sourceHeaders = (cfg: any, src: any): Record<string, string> => ({ ...(cfg.headers ?? {}), ...(src.headers ?? {}) });
const renderFlag = (cfg: any, src: any): boolean => !!('render' in src ? src.render : cfg.render);

async function sendRequest(ctx: Ctx, src: any, request: any, vars: Record<string, any>, headers: Record<string, string>, stats: SourceStats,
  urlOverride?: string | null, maxBytes?: number): Promise<[string, EngineResponse]> {
  const req = renderTemplate(request ?? {}, vars);
  let url: string = urlOverride ? renderTemplate(urlOverride, vars) : req.url;
  const missing = unresolved([url, req.params, req.json, req.headers, req.data, req.body]);
  if (missing.length) throw new ConfigError(`unfilled placeholders ${JSON.stringify(missing)} in request ${url}`);
  if (req.params && typeof req.params === 'object') {
    const u = new URL(url);
    for (const [k, v] of Object.entries(req.params)) u.searchParams.set(k, String(v));
    url = u.toString();
  }
  const method: 'GET' | 'POST' = String(req.method ?? 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET';
  const hdrs: Record<string, string> = { ...headers, ...(req.headers ?? {}) };
  const hasType = () => Object.keys(hdrs).some((k) => k.toLowerCase() === 'content-type');
  let body: string | null = null;
  if (method === 'POST') {
    if (req.json != null) { body = JSON.stringify(req.json); if (!hasType()) hdrs['content-type'] = 'application/json'; }
    else if (req.data != null) { body = typeof req.data === 'string' ? req.data : new URLSearchParams(req.data).toString(); if (!hasType()) hdrs['content-type'] = 'application/x-www-form-urlencoded'; }
    else if (req.body != null) body = String(req.body);
  }
  const resp = await ctx.fetch({ method, url, headers: hdrs, body, render: renderFlag(ctx.cfg, src), maxBytes, timeoutMs: ctx.timeoutMs });
  stats.requests++;
  stats.log.push(`${method} ${url.slice(0, 160)} -> ${resp.status || resp.error} (${(resp.ms / 1000).toFixed(1)}s)`);
  if (resp.blocked) stats.blocked++;
  return [url, resp];
}

async function pool<T>(initial: T[], worker: (t: T) => Promise<T[]>, limits: Limits, stats: SourceStats, maxTasks: number | undefined,
  key: (t: T) => string, depthFirst = false): Promise<void> {
  const queue = [...initial];
  const queued = new Set(initial.map(key));
  stats.tasksTotal = queue.length;
  let running = 0;
  let errorsInRow = 0;
  let stopped = false;
  await new Promise<void>((resolve) => {
    let resolved = false;
    const finish = () => { if (!resolved) { resolved = true; resolve(); } };
    const pump = () => {
      if (stopped) { if (running === 0) finish(); return; }
      if (expired(limits) && queue.length) { stats.stop('time limit'); queue.length = 0; }
      while (queue.length && running < Math.max(1, limits.workers) && (maxTasks == null || stats.tasksDone + running < maxTasks)) {
        const task = queue.shift()!;
        running++;
        worker(task).then((children) => { errorsInRow = 0; return children ?? []; }, (e) => {
          errorsInRow++;
          stats.errors.push(`${key(task).slice(0, 80)}: ${String(e?.message ?? e)}`.slice(0, 250));
          return [] as T[];
        }).then((children) => {
          running--;
          stats.tasksDone++;
          const fresh = children.filter((c) => !queued.has(key(c)));
          fresh.forEach((c) => queued.add(key(c)));
          if (depthFirst) queue.unshift(...fresh); else queue.push(...fresh);
          stats.tasksTotal += fresh.length;
          if (errorsInRow >= 25) { stats.stop(`stopped after ${errorsInRow} consecutive errors`); stopped = true; }
          pump();
        });
      }
      if (running === 0) finish();
    };
    pump();
  });
}

async function paginate(ctx: Ctx, src: any, vars: Record<string, any>, headers: Record<string, string>, limits: Limits, stats: SourceStats,
  onPage: (items: string[]) => boolean | string): Promise<{ items: number; reason: string }> {
  const pag = src.pagination ?? {};
  const listing = src.listing ?? {};
  const limit = limits.maxPages ?? pag.max_pages ?? 1000;
  const seen = new Set<string>();
  let total: number | null = null;
  let cursor = '';
  let nextUrl: string | null = null;
  let count = 0;
  for (let i = 0; i < limit; i++) {
    if (expired(limits)) return { items: count, reason: 'time limit' };
    const value = Number(pag.start ?? 1) + i * Number(pag.step ?? 1);
    Object.assign(vars, { page: value, offset: value, page_number: i + 1, cursor });
    const override = i === 0 && listing.first_page_url ? listing.first_page_url : pag.type === 'next_link' && i > 0 ? nextUrl : null;
    const [, resp] = await sendRequest(ctx, src, listing.request, vars, headers, stats, override);
    if (resp.error && !resp.status) return { items: count, reason: `request failed: ${resp.error.slice(0, 80)}` };
    if (resp.blocked) return { items: count, reason: 'blocked' };
    if (resp.status >= 400) return { items: count, reason: `HTTP ${resp.status} on page ${i + 1}` };
    const items = extract(src.items, resp.text, resp.url);
    const fresh = [...new Set(items)].filter((u) => !seen.has(u));
    fresh.forEach((u) => seen.add(u));
    count += items.length;
    const verdict = onPage(items);
    if (verdict === false || typeof verdict === 'string') return { items: count, reason: typeof verdict === 'string' ? verdict : `no globally new URLs for ${pag.global_stop_pages} pages` };
    if (!items.length) return { items: count, reason: `page ${i + 1} returned no items` };
    if (!fresh.length) return { items: count, reason: `page ${i + 1} repeated earlier items` };
    if (pag.total_items && total == null) {
      const found = extract(pag.total_items, resp.text);
      total = found[0] && /^\d+(\.\d+)?$/.test(found[0]) ? Math.floor(Number(found[0])) : null;
    }
    if (total != null && seen.size >= total) return { items: count, reason: `reached total of ${total} items` };
    if (pag.type === 'none') return { items: count, reason: 'single page listing' };
    if (pag.type === 'cursor') {
      const found = pag.cursor ? extract(pag.cursor, resp.text) : [];
      if (!found.length) return { items: count, reason: 'no next cursor' };
      cursor = found[0];
    }
    if (pag.type === 'next_link') {
      const found = pag.next_link ? extract(pag.next_link, resp.text, resp.url) : [];
      if (!found.length) return { items: count, reason: 'no next link' };
      nextUrl = found[0];
    }
  }
  return { items: count, reason: `max pages (${limit}) reached` };
}

function inputs(src: any, startUrl: string): Record<string, string> {
  const vars: Record<string, string> = { start_url: startUrl };
  for (const [name, pattern] of Object.entries(src.inputs ?? {})) {
    const m = new RegExp(String(pattern)).exec(startUrl);
    if (!m) throw new ConfigError(`input '${name}': regex ${pattern} does not match start URL ${startUrl}`);
    vars[name] = m[1] ?? m[0];
  }
  return vars;
}

async function runListing(ctx: Ctx, src: any, collector: Collector, stats: SourceStats, limits: Limits): Promise<void> {
  const cfg = ctx.cfg;
  const start = src.start_url || cfg.start_url || `https://${cfg.domain}/`;
  const baseVars = inputs(src, start);
  const headers = sourceHeaders(cfg, src);
  const seeds = src.seeds ?? {};
  const stopAfter = Number(src.pagination?.global_stop_pages ?? 0);
  const scrape: SeedExtractor = async (spec, combo) => {
    if (expired(limits)) return [];
    const [, resp] = await sendRequest(ctx, src, spec.request, { ...baseVars, ...combo }, headers, stats);
    return extract(spec.extractor ?? {}, resp.text, resp.url);
  };
  let combos: Array<Record<string, string>>;
  try {
    combos = await seedCombinations(seeds, scrape, limits.maxSeeds);
  } catch (e) {
    stats.errors.push(`seed generation failed: ${String((e as Error)?.message ?? e)}`.slice(0, 250));
    return;
  }
  await pool(combos, async (combo) => {
    let stale = 0;
    const label = Object.entries(combo).map(([k, v]) => `${k}=${v}`).join(', ');
    const res = await paginate(ctx, src, { ...baseVars, ...combo }, headers, limits, stats, (items) => {
      const fresh = collector.add(items, stats);
      stale = fresh.length ? 0 : stale + 1;
      if (expired(limits)) return 'time limit';
      return !(stopAfter && items.length && stale >= stopAfter);
    });
    if (res.reason.startsWith('request failed') || res.reason === 'blocked') stats.errors.push(`${label || 'listing'}: ${res.reason}`.slice(0, 250));
    stats.stop(res.reason.replace(/\d+/g, 'N'));
    return adaptiveChildren(seeds, combo, res.items);
  }, limits, stats, limits.maxSeeds, (c) => JSON.stringify(c));
}

async function runSitemap(ctx: Ctx, src: any, collector: Collector, stats: SourceStats, limits: Limits): Promise<void> {
  const cfg = ctx.cfg;
  let roots: string[] = src.sitemaps ?? [];
  if (!roots.length) {
    const base = new URL(cfg.start_url || `https://www.${cfg.domain}/`).origin;
    const robots = await ctx.fetch({ method: 'GET', url: `${base}/robots.txt`, timeoutMs: ctx.timeoutMs });
    stats.requests++;
    roots = robots.status === 200 ? [...robots.text.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]) : [];
    if (!roots.length) roots = [`${base}/sitemap.xml`];
  }
  const include = src.include ? new RegExp(src.include) : null;
  const urlFilter = src.url_filter ? new RegExp(src.url_filter) : null;
  await pool(roots, async (sm) => {
    const resp = await ctx.fetch({ method: 'GET', url: sm, headers: sourceHeaders(cfg, src), maxBytes: limits.sitemapBytes, timeoutMs: ctx.timeoutMs });
    stats.requests++;
    if (resp.status >= 400 || (!resp.status && resp.error)) { stats.stop(resp.status ? `HTTP ${resp.status}` : 'request failed'); return []; }
    const locs = [...resp.text.matchAll(LOC_RE)].map((m) => htmlUnescape(m[1]));
    if (/<sitemapindex/i.test(resp.text.slice(0, 2000))) { stats.stop('sitemap index'); return locs.filter((u) => !include || include.test(u)); }
    if (resp.truncated) stats.notes.push(`${sm}: sampled first ${Math.round(resp.text.length / 1024)} KB (${locs.length} URLs)`);
    collector.add(locs.filter((u) => !urlFilter || urlFilter.test(u)), stats);
    stats.stop('url set');
    return [];
  }, limits, stats, limits.maxRequests ?? src.max_sitemaps ?? 5000, (s) => s);
}

async function runAutocomplete(ctx: Ctx, src: any, collector: Collector, stats: SourceStats, limits: Limits): Promise<void> {
  const chars: string = src.chars || 'abcdefghijklmnopqrstuvwxyz';
  const threshold = Number(src.expand_threshold ?? 0);
  const maxDepth = Number(src.max_depth ?? 3);
  await pool<string>(src.start_prefixes ?? [...chars], async (prefix) => {
    const [, resp] = await sendRequest(ctx, src, src.request, { prefix, query: prefix }, sourceHeaders(ctx.cfg, src), stats);
    const values = extract(src.items, resp.text, resp.url);
    collector.add(values, stats);
    return threshold && values.length >= threshold && prefix.length < maxDepth ? [...chars].map((c) => prefix + c) : [];
  }, limits, stats, limits.maxRequests ?? src.max_requests ?? 20000, (s) => s);
}

export function pageLinks(html: string, base: string): string[] {
  if (looksJson(html)) return [];
  const $ = load(html ?? '');
  const out: string[] = [];
  $('a[href]').each((_, el) => { const h = $(el).attr('href') ?? ''; if (h && !/^(#|javascript:|mailto:|tel:)/i.test(h)) out.push(resolveUrl(h, base)); });
  return out;
}

async function runLinkCrawl(ctx: Ctx, src: any, collector: Collector, stats: SourceStats, limits: Limits): Promise<void> {
  const follow = src.follow ? new RegExp(src.follow) : null;
  const maxDepth = Number(src.max_depth ?? 3);
  const suffix = String(ctx.cfg.domain ?? '').replace(/^www\./, '');
  await pool<[string, number]>((src.start_urls ?? []).map((u: string) => [u, 0] as [string, number]), async ([url, depth]) => {
    const resp = await ctx.fetch({ method: 'GET', url, headers: sourceHeaders(ctx.cfg, src), render: renderFlag(ctx.cfg, src), timeoutMs: ctx.timeoutMs });
    stats.requests++;
    if (resp.blocked) stats.blocked++;
    if (resp.status >= 400 || !resp.status) { stats.stop(resp.status ? `HTTP ${resp.status}` : 'request failed'); return []; }
    const values = src.items ? extract(src.items, resp.text, resp.url) : pageLinks(resp.text, resp.url);
    collector.add(values, stats);
    if (depth >= maxDepth || !follow) return [];
    return pageLinks(resp.text, resp.url).filter((l) => hostOf(l).endsWith(suffix) && follow.test(l)).map((l) => [l.split('#')[0], depth + 1] as [string, number]);
  }, limits, stats, limits.maxRequests ?? src.max_pages ?? 5000, (t) => t[0]);
}

const RUNNERS: Record<string, (ctx: Ctx, src: any, c: Collector, s: SourceStats, l: Limits) => Promise<void>> = {
  listing: runListing, sitemap: runSitemap, autocomplete: runAutocomplete, link_crawl: runLinkCrawl,
};

/** Runs every source of a config (or the one given) with the limits; returns per-source stats. */
export async function runConfig(config: any, collector: Collector, limits: Limits, fetch: EngineFetch, requestTimeoutMs = 45_000): Promise<SourceStats[]> {
  const { cfg, problems } = normalizeConfig(config);
  if (problems.length) throw new ConfigError(problems.join('; '));
  const out: SourceStats[] = [];
  for (const src of cfg.sources) {
    const stats = new SourceStats(src.name, src.type);
    const started = Date.now();
    try {
      await RUNNERS[src.type]({ cfg, fetch, timeoutMs: requestTimeoutMs }, src, collector, stats, limits);
    } catch (e) {
      stats.errors.push(String((e as Error)?.message ?? e).slice(0, 250));
    }
    stats.seconds = (Date.now() - started) / 1000;
    out.push(stats);
  }
  return out;
}

// ---- G3 (harvest any list route, 2026-10-13): one list unit at a time ------------------------------
// The harvest walks a contract's list route in small resumable units (queue kind 'list_page') instead
// of one long run: a unit is one listing seed from a start page (up to pagesPerUnit pages), one
// link_crawl page, or one autocomplete prefix. A unit returns the profile URLs it found (in the
// collector) and the next units (seed combinations, the following pages, child hubs, longer prefixes).
// Same request, paging, extractor and seed rules as runConfig; nothing here writes anywhere.
export type ListUnit = { s: number; k: 'root' | 'combo' | 'url' | 'prefix'; c?: Record<string, string>; p?: number; u?: string; d?: number; x?: string };

export async function runListUnit(config: any, unit: ListUnit, collector: Collector, fetch: EngineFetch,
  opts: { pagesPerUnit: number; deadline: number; timeoutMs?: number }): Promise<{ stats: SourceStats; next: ListUnit[]; reason: string }> {
  const { cfg, problems } = normalizeConfig(config);
  if (problems.length) throw new ConfigError(problems.join('; '));
  const src = cfg.sources.at(unit.s);
  if (!src) throw new ConfigError(`list unit refers to source #${unit.s}, which the contract does not have`);
  const stats = new SourceStats(src.name, src.type);
  const ctx: Ctx = { cfg, fetch, timeoutMs: opts.timeoutMs ?? 45_000 };
  const limits: Limits = { workers: 1, deadline: opts.deadline };
  const headers = sourceHeaders(cfg, src);
  const next: ListUnit[] = [];
  if (src.type === 'sitemap') return { stats, next, reason: 'sitemap sources are seeded as sitemap queue rows' };

  if (src.type === 'listing') {
    const start = src.start_url || cfg.start_url || `https://${cfg.domain}/`;
    const baseVars = inputs(src, start);
    const seeds = src.seeds ?? {};
    const pag = src.pagination ?? {};
    const firstPage = Number(pag.start ?? 1);
    const step = Number(pag.step ?? 1);
    if (unit.k === 'root') {
      if (!Object.keys(seeds).length) {
        next.push({ s: unit.s, k: 'combo', c: {}, p: firstPage });
        return { stats, next, reason: 'no seeds: one list from the first page' };
      }
      const scrape: SeedExtractor = async (spec, combo) => {
        if (expired(limits)) return [];
        const [, resp] = await sendRequest(ctx, src, spec.request, { ...baseVars, ...combo }, headers, stats);
        return extract(spec.extractor ?? {}, resp.text, resp.url);
      };
      const combos = await seedCombinations(seeds, scrape);
      for (const c of combos) next.push({ s: unit.s, k: 'combo', c, p: firstPage });
      return { stats, next, reason: `${combos.length} seed combinations` };
    }
    const combo = unit.c ?? {};
    const pageStart = Number(unit.p ?? firstPage);
    const resumable = (pag.type ?? 'page') === 'page' || pag.type === 'offset';
    const listing = { ...(src.listing ?? {}) };
    if (pageStart !== firstPage) delete listing.first_page_url;
    const unitSrc = { ...src, listing, pagination: { ...pag, start: pageStart } };
    const unitLimits: Limits = { ...limits, maxPages: resumable ? opts.pagesPerUnit : undefined };
    const res = await paginate(ctx, unitSrc, { ...baseVars, ...combo }, headers, unitLimits, stats, (items) => {
      collector.add(items, stats);
      return expired(limits) ? 'time limit' : true;
    });
    const pagesDone = stats.requests;
    const maxPages = Number(pag.max_pages ?? Infinity);
    const usedSoFar = (pageStart - firstPage) / step + pagesDone;
    if (resumable && pagesDone > 0 && (res.reason.startsWith('max pages') || res.reason === 'time limit') && usedSoFar < maxPages) {
      next.push({ s: unit.s, k: 'combo', c: combo, p: pageStart + pagesDone * step });
    }
    if (pageStart === firstPage) for (const c of adaptiveChildren(seeds, combo, res.items)) next.push({ s: unit.s, k: 'combo', c, p: firstPage });
    return { stats, next, reason: res.reason };
  }

  if (src.type === 'link_crawl') {
    if (unit.k === 'root') {
      for (const u of (src.start_urls ?? []) as string[]) next.push({ s: unit.s, k: 'url', u, d: 0 });
      return { stats, next, reason: 'start pages' };
    }
    const follow = src.follow ? new RegExp(src.follow) : null;
    const maxDepth = Number(src.max_depth ?? 3);
    const suffix = String(cfg.domain ?? '').replace(/^www\./, '');
    const resp = await fetch({ method: 'GET', url: String(unit.u), headers, render: renderFlag(cfg, src), timeoutMs: ctx.timeoutMs });
    stats.requests++;
    if (resp.blocked) stats.blocked++;
    if (resp.status >= 400 || !resp.status) return { stats, next, reason: resp.status ? `HTTP ${resp.status}` : 'request failed' };
    collector.add(src.items ? extract(src.items, resp.text, resp.url) : pageLinks(resp.text, resp.url), stats);
    const depth = Number(unit.d ?? 0);
    if (follow && depth < maxDepth) {
      for (const l of pageLinks(resp.text, resp.url)) if (hostOf(l).endsWith(suffix) && follow.test(l)) next.push({ s: unit.s, k: 'url', u: l.split('#')[0], d: depth + 1 });
    }
    return { stats, next, reason: 'page read' };
  }

  if (src.type === 'autocomplete') {
    const chars: string = src.chars || 'abcdefghijklmnopqrstuvwxyz';
    if (unit.k === 'root') {
      for (const x of (src.start_prefixes ?? [...chars]) as string[]) next.push({ s: unit.s, k: 'prefix', x });
      return { stats, next, reason: 'start prefixes' };
    }
    const prefix = String(unit.x ?? '');
    const [, resp] = await sendRequest(ctx, src, src.request, { prefix, query: prefix }, headers, stats);
    const values = extract(src.items, resp.text, resp.url);
    collector.add(values, stats);
    const threshold = Number(src.expand_threshold ?? 0);
    if (threshold && values.length >= threshold && prefix.length < Number(src.max_depth ?? 3)) for (const c of [...chars]) next.push({ s: unit.s, k: 'prefix', x: prefix + c });
    return { stats, next, reason: `${values.length} values` };
  }
  return { stats, next, reason: `unsupported source type ${src.type}` };
}
