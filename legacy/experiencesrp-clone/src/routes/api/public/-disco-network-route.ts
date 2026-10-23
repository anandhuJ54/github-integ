// ============================================================================
// disco network route — route-based mapper step 5 (2026-10-07).
//
// Pure helpers (no network, no DB) used by disco-ai-worker's mapSite to find a
// background call (XHR / fetch) that lists profile pages, and how it pages.
// Everything here is evidence from the captured calls themselves:
//   - a call counts only when its response holds >= 3 profile links that match the
//     run's code-built profile rule (or IDs that build such links, which the caller
//     must still prove with the normal profile-page check);
//   - paging comes from the call's own query / body (preferably from two captured
//     calls to the same endpoint that differ only in a page/offset value);
//   - the caller proves paging by replaying the next call and finding new profiles.
// No AI is used. Cookies and login/session headers are never kept.
//
// The leading dash in the file name keeps it out of the file router.
// ============================================================================

export type CapturedCall = {
  url: string;
  method: string;
  status_code: number | null;
  request_headers: Record<string, string>;
  request_payload: string | null;
  response_body: string | null;
};

/** Oxylabs returns captured calls as `content` (an array) or `content.xhr`; accept both. */
export function normalizeCapturedCalls(content: unknown): CapturedCall[] {
  let c: unknown = content;
  if (typeof c === 'string') {
    try { c = JSON.parse(c); } catch { return []; }
  }
  if (c && !Array.isArray(c) && typeof c === 'object' && Array.isArray((c as any).xhr)) c = (c as any).xhr;
  if (!Array.isArray(c)) return [];
  const out: CapturedCall[] = [];
  for (const x of c) {
    if (!x || typeof x !== 'object') continue;
    const url = typeof (x as any).url === 'string' ? (x as any).url : '';
    if (!/^https?:\/\//i.test(url)) continue;
    const hdrs: Record<string, string> = {};
    const rh = (x as any).request_headers;
    if (rh && typeof rh === 'object') {
      for (const [k, v] of Object.entries(rh)) if (typeof v === 'string' || typeof v === 'number') hdrs[k.toLowerCase()] = String(v);
    }
    const body = (x as any).response_body;
    const payload = (x as any).request_payload;
    out.push({
      url,
      method: String((x as any).method ?? 'GET').toUpperCase(),
      status_code: typeof (x as any).status_code === 'number' ? (x as any).status_code : null,
      request_headers: hdrs,
      request_payload: typeof payload === 'string' ? payload : payload == null ? null : JSON.stringify(payload),
      response_body: typeof body === 'string' ? body : body == null ? null : JSON.stringify(body),
    });
  }
  return out;
}

/** JSON body of a response; tolerates an anti-XSSI prefix and base64-wrapped JSON. */
export function parseJsonLoose(s: string | null | undefined): unknown | undefined {
  if (s == null) return undefined;
  let t = s.trim().replace(/^\)\]\}',?\s*/, '').replace(/^for\s*\(;;\);\s*/, '');
  if (!t) return undefined;
  if (t[0] !== '{' && t[0] !== '[' && /^[A-Za-z0-9+/=\s]+$/.test(t) && t.length % 4 === 0) {
    try { t = Buffer.from(t, 'base64').toString('utf8').trim(); } catch { return undefined; }
  }
  if (t[0] !== '{' && t[0] !== '[') return undefined;
  try { return JSON.parse(t); } catch { return undefined; }
}

type Leaf = { path: string; key: string; value: unknown };
const WALK_MAX = 200_000;

/** Every primitive value with its generalised path (array indexes written as []). */
function walkLeaves(json: unknown, maxDepth = 25): Leaf[] {
  const out: Leaf[] = [];
  const stack: Array<{ v: unknown; path: string; key: string; d: number }> = [{ v: json, path: '$', key: '', d: 0 }];
  let n = 0;
  while (stack.length && n < WALK_MAX) {
    const { v, path, key, d } = stack.pop()!;
    n++;
    if (v == null || typeof v !== 'object') { out.push({ path, key, value: v }); continue; }
    if (d >= maxDepth) continue;
    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) stack.push({ v: v[i], path: `${path}[]`, key, d: d + 1 });
    } else {
      const entries = Object.entries(v as Record<string, unknown>);
      for (let i = entries.length - 1; i >= 0; i--) stack.push({ v: entries[i][1], path: `${path}.${entries[i][0]}`, key: entries[i][0], d: d + 1 });
    }
  }
  return out;
}

function absUrl(s: string, base: string): string | null {
  const t = s.trim();
  if (!t || t.length > 2000) return null;
  if (!/^https?:\/\//i.test(t) && !(t.startsWith('/') && !t.startsWith('//'))) return null;
  try { const u = new URL(t, base); u.hash = ''; return u.toString(); } catch { return null; }
}

/** Profile links in a JSON response that match the run's profile rule, and where they sit. */
export function profileUrlsInJson(
  json: unknown,
  pageUrl: string,
  matches: (u: string) => boolean,
): { urls: string[]; path: string | null } {
  const byPath = new Map<string, Set<string>>();
  for (const leaf of walkLeaves(json)) {
    if (typeof leaf.value !== 'string') continue;
    const u = absUrl(leaf.value, pageUrl);
    if (!u) continue;
    let hit = matches(u) ? u : null;
    if (!hit) { try { const x = new URL(u); x.search = ''; const y = x.toString(); if (matches(y)) hit = y; } catch { /* ignore */ } }
    if (!hit) continue;
    const s = byPath.get(leaf.path) ?? new Set<string>();
    s.add(hit);
    byPath.set(leaf.path, s);
  }
  const all = new Set<string>();
  for (const s of byPath.values()) for (const u of s) all.add(u);
  const best = [...byPath.entries()].sort((a, b) => b[1].size - a[1].size)[0];
  return { urls: [...all], path: best ? best[0] : null };
}

/**
 * Profile IDs that build profile links: a field repeated across the objects of one array whose
 * values, put into a known profile URL in place of one path part, match the profile rule.
 * Evidence level: `known_match` when a built link equals a profile link the run already saw;
 * otherwise the caller must prove one built link with the profile-page check.
 */
export function idTemplateHits(
  json: unknown,
  knownProfileUrls: string[],
  matches: (u: string) => boolean,
): { field_path: string; template: string; urls: string[]; known_match: boolean } | null {
  const templates = new Set<string>();
  for (const k of knownProfileUrls.slice(0, 20)) {
    try {
      const u = new URL(k);
      u.search = ''; u.hash = '';
      const segs = u.pathname.split('/');
      for (let i = 0; i < segs.length; i++) {
        if (!segs[i]) continue;
        const t = [...segs]; t[i] = '{v}';
        templates.add(`${u.origin}${t.join('/')}`);
      }
    } catch { /* ignore */ }
  }
  if (!templates.size) return null;
  const known = new Set(knownProfileUrls.map((u) => u.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase()));
  // values per field path, only paths that sit inside an array of objects
  const byPath = new Map<string, string[]>();
  for (const leaf of walkLeaves(json)) {
    if (!leaf.path.includes('[]')) continue;
    if (typeof leaf.value !== 'string' && typeof leaf.value !== 'number') continue;
    const v = String(leaf.value).trim();
    if (!v || v.length > 120 || !/^[A-Za-z0-9._~%-]+$/.test(v)) continue;
    const a = byPath.get(leaf.path) ?? [];
    a.push(v);
    byPath.set(leaf.path, a);
  }
  let best: { field_path: string; template: string; urls: string[]; known_match: boolean } | null = null;
  for (const [path, vals] of byPath) {
    const distinct = [...new Set(vals)];
    if (distinct.length < 3 || distinct.length < vals.length * 0.9) continue;
    for (const t of templates) {
      const built = distinct.map((v) => t.replace('{v}', encodeURIComponent(v)));
      const ok = built.filter((u) => matches(u) || matches(`${u}/`));
      if (ok.length < 3 || ok.length < built.length * 0.8) continue;
      const knownMatch = ok.some((u) => known.has(u.replace(/\/+$/, '').toLowerCase()));
      const cand = { field_path: path, template: t, urls: ok, known_match: knownMatch };
      if (!best || (knownMatch && !best.known_match) || (knownMatch === best.known_match && ok.length > best.urls.length)) best = cand;
    }
  }
  return best;
}

/** Profile links built from the ID field found by idTemplateHits (same field path and template). */
export function idUrlsAt(json: unknown, fieldPath: string, template: string, matches: (u: string) => boolean): string[] {
  const out = new Set<string>();
  for (const leaf of walkLeaves(json)) {
    if (leaf.path !== fieldPath) continue;
    if (typeof leaf.value !== 'string' && typeof leaf.value !== 'number') continue;
    const v = String(leaf.value).trim();
    if (!v || !/^[A-Za-z0-9._~%-]+$/.test(v)) continue;
    const u = template.replace('{v}', encodeURIComponent(v));
    if (matches(u) || matches(`${u}/`)) out.add(u);
  }
  return [...out];
}

// ---- profile links built from a record's own fields (2026-10-07) ------------------------------
// When a listing call returns records without links, a profile link can be rebuilt from the record
// itself: every variable part of the profile URL must equal one of that record's fields (as is, or
// as a URL slug of it, e.g. a name). The template is learned from a record whose own profile URL is
// already known (seen in sitemaps or on pages this run fetched), then applied to every record and
// kept only when the built links match the profile rule. No guessing of fields.
type RecordArray = { path: string; items: Array<Record<string, unknown>> };

function recordArrays(json: unknown, minItems = 3): RecordArray[] {
  const out: RecordArray[] = [];
  const stack: Array<{ v: unknown; path: string; d: number }> = [{ v: json, path: '$', d: 0 }];
  let n = 0;
  while (stack.length && n < 50_000) {
    const { v, path, d } = stack.pop()!;
    n++;
    if (!v || typeof v !== 'object' || d > 12) continue;
    if (Array.isArray(v)) {
      const objs = v.filter((x) => x && typeof x === 'object' && !Array.isArray(x)) as Array<Record<string, unknown>>;
      if (objs.length >= minItems && objs.length >= v.length * 0.8) out.push({ path: `${path}[]`, items: objs });
      for (const x of v.slice(0, 3)) stack.push({ v: x, path: `${path}[]`, d: d + 1 });
    } else {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) stack.push({ v: x, path: `${path}.${k}`, d: d + 1 });
    }
  }
  return out;
}

/** Primitive fields of one record (nested objects flattened with dots; arrays skipped). */
function recordFields(r: Record<string, unknown>, prefix = '', out: Array<[string, string]> = [], depth = 0): Array<[string, string]> {
  if (depth > 3) return out;
  for (const [k, v] of Object.entries(r)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v != null && typeof v === 'object' && !Array.isArray(v)) recordFields(v as Record<string, unknown>, key, out, depth + 1);
    else if (typeof v === 'string' || typeof v === 'number') {
      const t = String(v).trim();
      if (t && t.length <= 120) out.push([key, t]);
    }
  }
  return out;
}

export function slugify(v: string, dropApostrophes = true): string {
  let t = v.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (dropApostrophes) t = t.replace(/['’`]/g, '');
  return t.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

type TemplatePart = { lit: string } | { field: string; mode: 'raw' | 'slug' | 'slug2' };
export type RecordTemplate = { origin: string; parts: TemplatePart[]; trailingSlash: boolean };

function fieldValue(r: Record<string, unknown>, path: string): string | null {
  let v: unknown = r;
  for (const k of path.split('.')) { if (!v || typeof v !== 'object') return null; v = (v as Record<string, unknown>)[k]; }
  return typeof v === 'string' || typeof v === 'number' ? String(v).trim() : null;
}

export function buildFromTemplate(t: RecordTemplate, r: Record<string, unknown>): string | null {
  const segs: string[] = [];
  for (const p of t.parts) {
    if ('lit' in p) { segs.push(p.lit); continue; }
    const v = fieldValue(r, p.field);
    if (!v) return null;
    const s = p.mode === 'raw' ? encodeURIComponent(v) : slugify(v, p.mode === 'slug');
    if (!s) return null;
    segs.push(s);
  }
  return `${t.origin}/${segs.join('/')}${t.trailingSlash ? '/' : ''}`;
}

export function templateLabel(t: RecordTemplate): string {
  return `${t.origin}/${t.parts.map((p) => ('lit' in p ? p.lit : `{${p.mode === 'raw' ? '' : 'slug:'}${p.field}}`)).join('/')}${t.trailingSlash ? '/' : ''}`;
}

/** Learn a record template from a record whose profile URL is known; apply it to every record. */
export function recordTemplateHits(
  json: unknown,
  knownProfileUrls: string[],
  matches: (u: string) => boolean,
): { array_path: string; template: RecordTemplate; label: string; urls: string[] } | null {
  const known: Array<{ origin: string; segs: string[]; slash: boolean }> = [];
  for (const k of knownProfileUrls.slice(0, 300)) {
    try {
      const u = new URL(k);
      const segs = u.pathname.split('/').filter(Boolean).map((x) => decodeURIComponent(x).toLowerCase());
      if (segs.length) known.push({ origin: u.origin, segs, slash: u.pathname.endsWith('/') });
    } catch { /* ignore */ }
  }
  if (!known.length) return null;
  // A part may stay literal only when it is a site section: the same value at that position in at
  // least half of the known profile URLs with the same number of parts (e.g. "agent").
  const posCount = new Map<string, number>();
  const lenCount = new Map<number, number>();
  for (const k of known) {
    lenCount.set(k.segs.length, (lenCount.get(k.segs.length) ?? 0) + 1);
    k.segs.forEach((seg, i) => posCount.set(`${k.segs.length}|${i}|${seg}`, (posCount.get(`${k.segs.length}|${i}|${seg}`) ?? 0) + 1));
  }
  const isSection = (len: number, i: number, seg: string) =>
    (lenCount.get(len) ?? 0) >= 2 && (posCount.get(`${len}|${i}|${seg}`) ?? 0) >= (lenCount.get(len) ?? 0) * 0.5;
  let best: { array_path: string; template: RecordTemplate; label: string; urls: string[] } | null = null;
  for (const arr of recordArrays(json)) {
    const learned = new Map<string, RecordTemplate>();
    for (const r of arr.items.slice(0, 100)) {
      const fields = recordFields(r);
      if (!fields.length) continue;
      for (const k of known) {
        let mapped = 0;
        let idLike = false;
        const parts: TemplatePart[] = k.segs.map((seg) => {
          for (const [f, v] of fields) {
            if (v.toLowerCase() === seg) { mapped++; if (/\d/.test(v)) idLike = true; return { field: f, mode: 'raw' as const }; }
          }
          for (const [f, v] of fields) {
            if (slugify(v, true) === seg) { mapped++; return { field: f, mode: 'slug' as const }; }
            if (slugify(v, false) === seg) { mapped++; return { field: f, mode: 'slug2' as const }; }
          }
          return { lit: seg };
        });
        // The record must explain the profile-specific part: at least one id-like value, and no
        // segment left literal that looks like it belongs to one person (contains a digit).
        if (!mapped || !idLike) continue;
        if (parts.some((p, i) => 'lit' in p && !isSection(k.segs.length, i, p.lit))) continue;
        const t: RecordTemplate = { origin: k.origin, parts, trailingSlash: k.slash };
        learned.set(templateLabel(t), t);
      }
    }
    for (const [label, t] of learned) {
      const built = arr.items.map((r) => buildFromTemplate(t, r)).filter((u): u is string => !!u);
      const ok = [...new Set(built.filter((u) => matches(u)))];
      if (ok.length < 3 || ok.length < arr.items.length * 0.8) continue;
      if (!best || ok.length > best.urls.length) best = { array_path: arr.path, template: t, label, urls: ok };
    }
  }
  return best;
}

/** Profile links from a response using a learned record template (same array path). */
export function recordUrlsAt(json: unknown, arrayPath: string, t: RecordTemplate, matches: (u: string) => boolean): string[] {
  const arr = recordArrays(json, 1).find((a) => a.path === arrayPath);
  if (!arr) return [];
  return [...new Set(arr.items.map((r) => buildFromTemplate(t, r)).filter((u): u is string => !!u && matches(u)))];
}

// ---- paging ------------------------------------------------------------------
const PAGE_KEY_RE = /^(page|pagenum|pagenumber|page_number|pageno|page_no|pg|p|currentpage|current_page|pageindex|page_index)$/i;
const OFFSET_KEY_RE = /^(offset|start|from|skip|startindex|start_index|startrow|start_row)$/i;
// Fix (numeric cursor offsets, 2026-10-07): a numeric value in a cursor-named field (after, cursor,
// start_after, search_after) is an offset (kw.com GraphQL sends `first: 12, after: 12`).
const CURSOR_NUM_KEY_RE = /^(after|cursor|startafter|start_after|searchafter|search_after|skiptoken|skip_token)$/i;
const SIZE_KEY_RE = /^(size|pagesize|page_size|limit|rows|perpage|per_page|hitsperpage|hits_per_page|resultsperpage|results_per_page|take|first|count|num)$/i;
const TOTAL_KEY_RE = /^(total|numfound|num_found|nbhits|nb_hits|(total|num|result|results|hit|hits|record|records|item|items|match|matches)_?(count|total|results|hits|records|items|matches|size|elements|resultcount|result_count|resultscount|results_count))$/i;
const TOTAL_PAGES_KEY_RE = /^(totalpages|total_pages|nbpages|pagecount|page_count|numpages|num_pages|lastpage|last_page)$/i;

export type ParamWhere = 'query' | 'query_json' | 'body_json' | 'body_form';
export type ParamRef = { where: ParamWhere; param?: string; path: string[] };
export type Paging = {
  kind: 'page' | 'offset';
  key: ParamRef;
  key_name: string;
  current: number;
  step: number;
  page_size: number | null;
  found_by: 'two_captured_calls' | 'parameter_name';
};

type Flat = { ref: ParamRef; name: string; value: unknown };

function flatJson(obj: unknown, where: ParamWhere, param: string | undefined, path: string[] = [], out: Flat[] = [], depth = 0): Flat[] {
  if (depth > 12 || obj == null) return out;
  if (Array.isArray(obj)) return out; // paging values do not live inside arrays
  if (typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const p = [...path, k];
    if (v != null && typeof v === 'object') flatJson(v, where, param, p, out, depth + 1);
    else out.push({ ref: { where, param, path: p }, name: k, value: v });
  }
  return out;
}

/** Every request parameter of a call: query values (and JSON inside a query value) and body fields. */
export function callParams(call: { url: string; request_payload: string | null }): Flat[] {
  const out: Flat[] = [];
  try {
    const u = new URL(call.url);
    u.searchParams.forEach((v, k) => {
      const j = v.trim().startsWith('{') ? parseJsonLoose(v) : undefined;
      if (j && typeof j === 'object') flatJson(j, 'query_json', k, [], out);
      else out.push({ ref: { where: 'query', path: [k] }, name: k, value: v });
    });
  } catch { /* ignore */ }
  const body = call.request_payload;
  if (body && body.trim()) {
    const j = parseJsonLoose(body);
    if (j && typeof j === 'object') flatJson(j, 'body_json', undefined, [], out);
    else if (/^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(body.trim())) {
      new URLSearchParams(body.trim()).forEach((v, k) => out.push({ ref: { where: 'body_form', path: [k] }, name: k, value: v }));
    }
  }
  return out;
}

const refKey = (r: ParamRef) => `${r.where}|${r.param ?? ''}|${r.path.join('.')}`;
const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\d{1,7}$/.test(v.trim())) return Number(v.trim());
  return null;
};
export const endpointKey = (c: { method: string; url: string }) => {
  try { const u = new URL(c.url); return `${c.method.toUpperCase()} ${u.origin}${u.pathname}`; } catch { return `${c.method} ${c.url}`; }
};

function sizeFrom(params: Flat[]): number | null {
  for (const f of params) if (SIZE_KEY_RE.test(f.name)) { const n = num(f.value); if (n && n > 0 && n <= 1000) return n; }
  return null;
}

/** Paging from two captured calls to the same endpoint that differ only in one numeric value. */
export function pagingFromTwoCalls(a: CapturedCall, b: CapturedCall): Paging | null {
  if (endpointKey(a) !== endpointKey(b)) return null;
  const pa = callParams(a);
  const pb = new Map(callParams(b).map((f) => [refKey(f.ref), f]));
  const diffs: Array<{ f: Flat; va: number; vb: number }> = [];
  let otherDiff = 0;
  for (const f of pa) {
    const g = pb.get(refKey(f.ref));
    if (!g) continue;
    if (String(f.value) === String(g.value)) continue;
    // A different operation on a shared endpoint (GraphQL operationName / query) is not page 2.
    if (/^(operationname|operation|query|queryid|queryname|op|action)$/i.test(f.name)) return null;
    const va = num(f.value); const vb = num(g.value);
    if (va != null && vb != null) diffs.push({ f, va, vb }); else otherDiff++;
  }
  // also a page key present only in the second call (page 1 often sends none)
  if (!diffs.length) {
    const aKeys = new Set(pa.map((f) => refKey(f.ref)));
    for (const g of pb.values()) {
      if (aKeys.has(refKey(g.ref))) continue;
      const vb = num(g.value);
      if (vb == null) continue;
      if (PAGE_KEY_RE.test(g.name) && vb === 2) diffs.push({ f: g, va: 1, vb: 2 });
      else if ((OFFSET_KEY_RE.test(g.name) || CURSOR_NUM_KEY_RE.test(g.name)) && vb > 0) diffs.push({ f: g, va: 0, vb });
    }
  }
  if (diffs.length !== 1 || otherDiff > 2) return null;
  const { f, va, vb } = diffs[0];
  if (vb <= va) return null;
  const isOffset = OFFSET_KEY_RE.test(f.name) || CURSOR_NUM_KEY_RE.test(f.name) || vb - va > 1;
  return {
    kind: isOffset ? 'offset' : 'page',
    key: f.ref,
    key_name: f.name,
    current: vb,
    step: vb - va,
    page_size: sizeFrom(pa) ?? (isOffset ? vb - va : null),
    found_by: 'two_captured_calls',
  };
}

/** Paging from a page / offset parameter the call itself sends (no guessing of absent keys). */
export function pagingFromParams(call: CapturedCall, itemsOnPage: number): Paging | null {
  const params = callParams(call);
  const size = sizeFrom(params);
  for (const f of params) {
    if (!PAGE_KEY_RE.test(f.name)) continue;
    const n = num(f.value);
    if (n == null || n > 10_000) continue;
    return { kind: 'page', key: f.ref, key_name: f.name, current: n, step: 1, page_size: size, found_by: 'parameter_name' };
  }
  for (const f of params) {
    if (!OFFSET_KEY_RE.test(f.name) && !CURSOR_NUM_KEY_RE.test(f.name)) continue;
    const n = num(f.value);
    if (n == null) continue;
    const step = size ?? itemsOnPage;
    if (!step) continue;
    return { kind: 'offset', key: f.ref, key_name: f.name, current: n, step, page_size: size ?? itemsOnPage, found_by: 'parameter_name' };
  }
  return null;
}

/** Total results / total pages the response states, if any. */
export function totalsInJson(json: unknown, itemsOnPage: number): { total: number | null; total_key: string | null; total_pages: number | null } {
  let total: number | null = null; let totalKey: string | null = null; let pages: number | null = null;
  for (const leaf of walkLeaves(json, 5)) {
    if (leaf.path.includes('[]')) continue;
    const n = num(leaf.value);
    if (n == null) continue;
    const key = leaf.key === 'value' && /\.total\.value$/i.test(leaf.path) ? 'total' : leaf.key;
    if (TOTAL_KEY_RE.test(key) && n > itemsOnPage && (total == null || n > total)) { total = n; totalKey = leaf.path; }
    else if (TOTAL_PAGES_KEY_RE.test(key) && n >= 1 && (pages == null || n > pages)) pages = n;
  }
  return { total, total_key: totalKey, total_pages: pages };
}

function setIn(obj: any, path: string[], value: unknown): void {
  let o = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (o[path[i]] == null || typeof o[path[i]] !== 'object') return;
    o = o[path[i]];
  }
  const last = path[path.length - 1];
  o[last] = typeof o[last] === 'string' ? String(value) : value;
}

/** The call with its paging value set to `value` (same method, headers and other fields). */
export function callWithPage(call: CapturedCall, key: ParamRef, value: number): { url: string; body: string | null } | null {
  try {
    const u = new URL(call.url);
    let body = call.request_payload;
    if (key.where === 'query') u.searchParams.set(key.path[0], String(value));
    else if (key.where === 'query_json' && key.param) {
      const j = parseJsonLoose(u.searchParams.get(key.param) ?? '') as any;
      if (!j || typeof j !== 'object') return null;
      setIn(j, key.path, value);
      u.searchParams.set(key.param, JSON.stringify(j));
    } else if (key.where === 'body_json') {
      const j = parseJsonLoose(body ?? '') as any;
      if (!j || typeof j !== 'object') return null;
      setIn(j, key.path, value);
      body = JSON.stringify(j);
    } else if (key.where === 'body_form') {
      const p = new URLSearchParams(body ?? '');
      p.set(key.path[0], String(value));
      body = p.toString();
    }
    return { url: u.toString(), body };
  } catch { return null; }
}

/** Headers safe to replay and store: no cookies, no login / session / token headers. */
export function replayHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k0, v] of Object.entries(h)) {
    const k = k0.toLowerCase();
    if (k.startsWith(':') || k.startsWith('sec-')) continue;
    if (/^(cookie|authorization|proxy-authorization|host|content-length|accept-encoding|connection|user-agent|upgrade-insecure-requests|priority|te)$/.test(k)) continue;
    if (/token|session|csrf|xsrf|auth|cookie|bearer/.test(k)) continue;
    out[k] = v;
  }
  return out;
}

// Fix (trackers dropped, 2026-10-07): analytics, ad, tag-manager, session-recording, consent,
// bot-detection / challenge and error-monitoring calls are never profile listings; they are dropped
// before checking (generic vendor hosts and tracking-style paths, no site names). Dropped calls are
// counted in the run report.
const NOISE_HOST_RE = new RegExp(
  '(^|[./])(' +
    [
      // analytics, tags, ads, attribution
      'google-analytics\\.com', 'analytics\\.google\\.com', 'googletagmanager\\.com', 'doubleclick\\.net', 'googlesyndication\\.com',
      'googleadservices\\.com', 'adservice\\.google\\.[a-z.]+', 'facebook\\.(com|net)', 'fbcdn\\.net', 'connect\\.facebook', 'adsrvr\\.org', 'criteo\\.(com|net)',
      'quantserve\\.com', 'scorecardresearch\\.com', 'taboola\\.com', 'outbrain\\.com', 'bing\\.com', 'bat\\.bing', 'clarity\\.ms', 'tiktok\\.com',
      'analytics\\.tiktok', 'snapchat\\.com', 'sc-static\\.net', 'licdn\\.com', 'ads\\.linkedin\\.com', 'pinterest\\.com', 'pinimg\\.com', 'twitter\\.com',
      'ads-twitter\\.com', 'reddit\\.com', 'redditstatic\\.com', 'yahoo\\.com', 'amazon-adsystem\\.com', 'adnxs\\.com', 'rubiconproject\\.com',
      'pubmatic\\.com', 'casalemedia\\.com', 'demdex\\.net', 'omtrdc\\.net', 'everesttech\\.net', 'agkn\\.com', 'rlcdn\\.com', 'bluekai\\.com',
      'krxd\\.net', 'mathtag\\.com', 'tapad\\.com', 'adroll\\.com', 'zemanta\\.com', 'branch\\.io', 'appsflyer\\.com', 'adjust\\.com',
      'segment\\.(io|com)', 'mixpanel\\.com', 'amplitude\\.com', 'heap(analytics)?\\.(io|com)', 'fullstory\\.com', 'hotjar\\.(com|io)', 'mouseflow\\.com',
      'crazyegg\\.com', 'quantummetric\\.com', 'contentsquare\\.net', 'glassboxdigital\\.io', 'logrocket\\.(com|io)', 'smartlook\\.com', 'optimizely\\.com',
      'abtasty\\.com', 'vwo\\.com', 'visualwebsiteoptimizer\\.com', 'kameleoon\\.(com|eu)', 'launchdarkly\\.com', 'split\\.io', 'tealiumiq\\.com',
      'tiqcdn\\.com', 'ensighten\\.com', 'cdn\\.mxpnl\\.com', 'hs-analytics\\.net', 'hubspot\\.com', 'hsforms\\.com', 'hs-scripts\\.com',
      'marketo\\.(com|net)', 'mktoresp\\.com', 'pardot\\.com', 'salesforceliveagent\\.com', 'intercom\\.io', 'intercomcdn\\.com', 'drift\\.com',
      'zendesk\\.com', 'zdassets\\.com', 'livechatinc\\.com', 'qualtrics\\.com', 'medallia\\.com', 'usabilla\\.com',
      // consent managers
      'onetrust\\.com', 'cookielaw\\.org', 'cookiebot\\.com', 'trustarc\\.com', 'osano\\.com', 'usercentrics\\.eu', 'didomi\\.io', 'termly\\.io',
      'consensu\\.org', 'privacymanager\\.io', 'evidon\\.com', 'ketchjs\\.com',
      // bot detection, challenges, fingerprinting
      'px-cloud\\.net', 'perimeterx\\.net', 'px-cdn\\.net', 'pxchk\\.net', 'kasada\\.io', 'kpsdk', 'datadome\\.co', 'captcha-delivery\\.com',
      'incapsula\\.com', 'imperva\\.com', 'hcaptcha\\.com', 'recaptcha\\.net', 'arkoselabs\\.com', 'funcaptcha\\.com', 'fingerprint\\.com',
      'fpjs\\.io', 'fpcdn\\.io', 'distil(networks)?\\.(com|net)', 'shapesecurity\\.com', 'forter\\.com', 'sift(science)?\\.com', 'iesnare\\.com',
      'threatmetrix\\.com', 'online-metrix\\.net', 'challenges\\.cloudflare\\.com', 'cloudflareinsights\\.com',
      // monitoring
      'newrelic\\.com', 'nr-data\\.net', 'datadoghq\\.(com|eu)', 'browser-intake-datadoghq', 'sentry\\.io', 'sentry-cdn\\.com', 'bugsnag\\.com',
      'rollbar\\.com', 'trackjs\\.com', 'raygun\\.io', 'dynatrace\\.com', 'akstat\\.io', 'go-mpulse\\.net', 'speedcurve\\.com', 'elastic-apm',
      // maps, fonts, video, social widgets
      'maps\\.googleapis\\.com', 'maps\\.gstatic\\.com', 'fonts\\.googleapis\\.com', 'fonts\\.gstatic\\.com', 'use\\.typekit\\.net', 'youtube\\.com',
      'ytimg\\.com', 'vimeo\\.com', 'vimeocdn\\.com', 'wistia\\.(com|net)', 'brightcove\\.(com|net)',
    ].join('|') +
    ')',
  'i',
);
// Tracking-style paths on any host (including the site's own collectors and event endpoints).
const NOISE_PATH_RE = /\/(collect|collector|collectors|events?|track|tracking|tracker|beacon|beacons|pixel|pixels|telemetry|rum|metrics|analytics|log|logs|logging|ping|heartbeat|gen_204|generate_204|impression|impressions|identify|batch|vitals|web-vitals|cdn-cgi|\.well-known)(\/|\?|$|\.)/i;
const ASSET_RE = /\.(js|mjs|css|png|jpe?g|gif|webp|avif|svg|woff2?|ttf|otf|eot|ico|mp4|webm|mp3|m3u8|ts|map)(\?|#|$)/i;
export function noiseReason(url: string): string | null {
  let host = '';
  let path = '';
  try { const u = new URL(url); host = u.host; path = u.pathname; } catch { return 'bad url'; }
  if (NOISE_HOST_RE.test(host)) return 'tracker / third-party service';
  if (ASSET_RE.test(path)) return 'static asset';
  if (NOISE_PATH_RE.test(path)) return 'tracking-style path';
  return null;
}
export const isNoiseCall = (url: string) => noiseReason(url) !== null;
