// ============================================================================
// disco agent mapper — site mapper version 2 (AI agent), dry runs only (2026-10-09).
//
// A second site mapper built next to the current one (disco-ai-worker.ts, unchanged), following
// the approach of the standalone AutoCrawl tool: Claude researches one site with tools - a live
// remote browser (Oxylabs Headless Browser) whose page traffic it can read and replay, fetches
// through the Oxylabs Web Scraper API, sitemap reads - and must prove a crawl method on samples
// (test_source), measure coverage from an independent path (coverage_check, 90% or a written
// reason) and pass a final validation before its config is accepted (submit_config).
//
// Dry runs only: nothing is written to any table. A worker call stops about 4 minutes in and
// returns { status: 'continue', state }; the next call sends that state back and the research
// continues in the same browser tab. The last call returns { status: 'done', ... } with the config,
// the research report, the validation, cost and timings.
//
// POST /api/public/disco-agent-mapper   header x-disco-worker-key
// body: { dry_run: true, domain, category, start_url?, model?, effort?, minutes?, budget?,
//         max_fetches?, no_browser?, call_seconds? (120-900, default 240), state? }
// ============================================================================
import { createFileRoute } from '@tanstack/react-router';
import { scrapeWebsite, fetchApiCall } from './disco-webscraper-worker';
import * as E from './-disco-agent-engine';
import { RemoteBrowser, BrowserError, type BrowserState, type NetRecord } from './-disco-agent-browser';
import { SYSTEM_PROMPT, TOOLS, PARALLEL_TOOLS, HEAVY_TOOLS } from './-disco-agent-prompt';

const DEFAULT_MODEL = 'claude-sonnet-5-5';
// Fix (ETL AI cost log, 2026-10-22): the price list moved to -disco-ai-cost.ts (shared with the cost log); same values.
import { PRICES, noteAiUsage } from './-disco-ai-cost';
const CALL_BUDGET_MS = 240_000;        // one worker call; the platform stops a request at ~300 s
const MAX_MINUTES = 10;                // research ceiling across calls (active time)
const SUBMIT_RESERVE_MS = 75_000;
const MAX_RESULT_CHARS = 8_000;
const SITEMAP_SAMPLE_BYTES = 400_000;
const TOOL_CAPS: Record<string, number> = { test_source: 60_000, coverage_check: 90_000, submit_config: 75_000, search_scripts: 45_000 };
const TEST_LIMITS: Record<string, Partial<E.Limits>> = {
  listing: { maxSeeds: 2, maxPages: 2 }, sitemap: { maxRequests: 3 }, autocomplete: { maxRequests: 6 }, link_crawl: { maxRequests: 6 },
};
const CLIENT_MANAGED_HEADERS = new Set([
  'host', 'connection', 'content-length', 'accept-encoding', 'user-agent', 'cookie', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform',
  'sec-ch-ua-full-version-list', 'sec-ch-ua-arch', 'sec-ch-ua-bitness', 'sec-ch-ua-model', 'sec-ch-ua-platform-version', 'sec-ch-ua-wow64',
  'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-user', 'upgrade-insecure-requests', 'priority', 'te', 'accept-language',
]);
const BLOCK_MARKERS = /KPSDK|Access Denied|captcha|cf-chl|challenge-platform|px-captcha|_pxCaptcha|datadome|Request unsuccessful\. Incapsula/i;

class LimitReached extends Error {}

type Stored = { ref: string; url: string; status: number; text: string };
type AgentState = {
  v: 1; domain: string; category: string; category_label: string; start_url: string;
  model: string; effort: string | null; budget: number; minutes: number; max_fetches: number; use_browser: boolean;
  active_ms: number; calls: number; turns: number; cost: number; tokens: Record<string, number>; fetches: number;
  browser_actions: number; key_search_done: boolean; settings: Record<string, any>; coverage: Record<string, number>;
  proven: Record<string, any>; responses: Stored[]; response_count: number; browser: BrowserState | null; browser_error: string | null;
  messages: any[]; notices: string[]; nudges: number; pending_calls: any[] | null; result: any | null; pending: any | null; log: string[];
  other_domains?: Record<string, OtherDomain>;
};
type OtherDomain = { host: string; kind: 'sister_domain' | 'third_party'; why: string[]; samples: string[]; count: number };

// ---- helpers ----------------------------------------------------------------------------
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const t = setTimeout(() => resolve(fallback), Math.max(1, ms));
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(fallback); });
  });
}
function stable(v: any): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
const categoryLabel = (c: string) => c.replace(/^gcid:/, '').replace(/[_-]+/g, ' ').trim();
const looksBlocked = (status: number, text: string) => [401, 403, 407, 429, 503].includes(status) || ((text ?? '').length < 20_000 && BLOCK_MARKERS.test(text ?? ''));
function cleanHeaders(h?: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(h ?? {}).filter(([k]) => !CLIENT_MANAGED_HEADERS.has(k.toLowerCase()) && !k.startsWith(':')));
}

/** The one network path of version 2 (besides the browser): Oxylabs Web Scraper API. */
export async function oxyFetch(r: E.EngineRequest): Promise<E.EngineResponse> {
  const started = Date.now();
  const headers = cleanHeaders(r.headers);
  const miss = (error: string): E.EngineResponse => ({ url: r.url, status: 0, text: '', blocked: false, truncated: false, error, ms: Date.now() - started });
  try {
    let status = 0;
    let text = '';
    let finalUrl = r.url;
    if (r.render) {
      if (r.method !== 'GET' || Object.keys(headers).length) return miss('render works for GET requests without custom headers only');
      const res = await withTimeout(scrapeWebsite({ url: r.url, crawl_method: 'needs_js_api', render: true, fallback_render: false }), r.timeoutMs, null as any);
      if (!res) return miss(`timed out after ${Math.round(r.timeoutMs / 1000)} s`);
      if (res.status_code == null && !res.content) return miss(res.error ?? 'no response');
      status = res.status_code ?? 0;
      text = res.content ?? '';
      finalUrl = res.resolved_url ?? r.url;
    } else {
      const res = await fetchApiCall({ url: r.url, method: r.method, headers, body: r.body ?? null, crawl_method: 'server_crawl', timeoutMs: r.timeoutMs });
      if (res.status_code == null && !res.content) return miss(res.error ?? 'no response');
      status = res.status_code ?? 0;
      text = res.content ?? '';
    }
    const truncated = !!(r.maxBytes && text.length > r.maxBytes);
    if (truncated) text = text.slice(0, r.maxBytes);
    return { url: finalUrl, status, text, blocked: looksBlocked(status, text), truncated, ms: Date.now() - started };
  } catch (e) {
    return miss(String((e as Error)?.message ?? e).slice(0, 300));
  }
}

// ---- the explorer -------------------------------------------------------------------------
class Explorer {
  browser: RemoteBrowser | null = null;
  callStart = Date.now();
  callDeadline = Date.now() + CALL_BUDGET_MS;
  constructor(public st: AgentState, callMs = CALL_BUDGET_MS) { this.callDeadline = this.callStart + callMs; }

  // Fix (site only, 2026-10-09): every request version 2 makes - research fetches, sitemap reads, script
  // searches, crawl-method tests, coverage checks, validation and the final config - stays on the site's
  // own domain and its subdomains. Third-party services the site uses (search / locator vendors, CDNs)
  // are not used, even when the site's own pages call them (wellsfargoadvisors.com dry run 3978 tried a
  // Yext search API).
  site(): string { return E.siteDomain(this.st.domain); }
  onSite(url: string): boolean { const h = E.hostOf(url); const s = this.site(); return !!h && (h === s || h.endsWith(`.${s}`)); }
  offsite(url: string): string {
    this.noteOther(url, 'request refused by the site-only rule');
    return `${url} is outside ${this.site()}: only ${this.site()} and its subdomains may be used (third-party services are not allowed). If profiles or their data live there, call note_other_domain with the evidence - it is flagged for a person to approve; it is not used now.`;
  }
  // Fix (other-domain observations, 2026-10-09): domains outside the site are never used for mapping,
  // but they are recorded with evidence and returned as flags (sister domain of the brand, or a
  // third-party service the site's pages load data from), so a person can approve one on a remap
  // (e.g. ameripriseadvisors.com for ameriprise.com, bairdwealth.com for rwbaird.com, a vendor API).
  noteOther(urlOrHost: string, why: string, samples: string[] = []) {
    const host = (/^https?:\/\//i.test(urlOrHost) ? E.hostOf(urlOrHost) : String(urlOrHost).toLowerCase().replace(/\/.*$/, '')).replace(/^www\./, '');
    if (!host || this.onSite(`https://${host}/`)) return;
    const reg = E.siteDomain(host);
    const map = (this.st.other_domains ??= {});
    const brand = this.site().split('.')[0];
    const other = reg.split('.')[0];
    let common = 0;
    for (let i = 0; i < brand.length; i++) for (let j = i + common + 1; j <= brand.length; j++) { if (other.includes(brand.slice(i, j))) common = j - i; else break; }
    const entry = map[reg] ?? { host: reg, kind: common >= 5 ? 'sister_domain' : 'third_party', why: [], samples: [], count: 0 };
    entry.count++;
    if (!entry.why.includes(why) && entry.why.length < 6) entry.why.push(why);
    for (const u of [/^https?:/i.test(urlOrHost) ? urlOrHost : null, ...samples].filter(Boolean) as string[]) {
      if (!entry.samples.includes(u) && entry.samples.length < 5) entry.samples.push(String(u).slice(0, 300));
    }
    map[reg] = entry;
  }
  // Fix (flag noise, 2026-10-09): ad auctions, analytics, A/B testing, surveys and map/consent
  // services were flagged as data sources (remax.com: 15 ad-tech hosts). A third-party data call is
  // flagged only when it is not such a service and its JSON response holds a list of records.
  collectBrowserOtherDomains() {
    if (!this.browser) return;
    const noise = /prebid|openrtb|auction|bid(?:request)?\b|hbid|\/hb[-/]|adsystem|adserver|adnxs|doubleclick|gumgum|casalemedia|3lift|media\.net|pubmatic|rubicon|criteo|id5-sync|onetag|yellowblue|ingage\.tech|fsrv\.io|t13\.io|ccgateway|flashtalking|ftstatic|adobedc|omtrdc|demdex|qualtrics|launchdarkly|go-mpulse|akstat|contentsquare|niceincontact|awswaf|maps\.googleapis|places\.googleapis|gen_204|optimizely|segment\.(?:io|com)|newrelic|nr-data|sentry|datadog|hotjar|clarity\.ms|onetrust|cookielaw|googletagmanager|google-analytics|facebook|tiktok|linkedin|bing\.com|yahoo\.com|amazon-adsystem|criteo|taboola|outbrain|on\.aws\/events|\/events?(?:\/|\?|$)|\/collect\b|\/beacon|\/pixel|\/track/i;
    for (const r of this.browser.records.values()) {
      if (['XHR', 'Fetch'].includes(r.type) && !this.onSite(r.url) && /json|graphql/i.test(r.mime_type ?? '')
        && !noise.test(r.url) && E.findLists(E.parseJson(r.body ?? ''), 3, 1).length > 0) {
        this.noteOther(r.url, `data call made by the site's pages (${r.method} ${r.status ?? ''} ${r.mime_type ?? ''})`.trim());
      }
    }
  }
  otherDomainFlags() {
    this.collectBrowserOtherDomains();
    const list = Object.values(this.st.other_domains ?? {}).sort((a, b) => Number(a.kind !== 'sister_domain') - Number(b.kind !== 'sister_domain') || b.count - a.count);
    return list.length ? { other_domains: list.slice(0, 15), note: 'Not used for mapping. A person can approve one of these domains on a remap after checking it manually.' } : null;
  }
  async t_note_other_domain(a: any) {
    const target = String(a.url ?? a.host ?? '');
    if (!target) throw new Error('note_other_domain needs url or host');
    if (this.onSite(/^https?:/i.test(target) ? target : `https://${target}/`)) return { noted: false, reason: 'that host is part of the site; use it directly' };
    this.noteOther(target, `reported by the mapper: ${String(a.why ?? '').slice(0, 300)}`, Array.isArray(a.sample_urls) ? a.sample_urls.slice(0, 5).map(String) : []);
    return { noted: true, note: 'Flagged for a person to approve on a remap; it is not used now. Continue with the site\'s own options, or give up if there are none.' };
  }
  siteFetch = (r: E.EngineRequest): Promise<E.EngineResponse> => (this.onSite(r.url)
    ? oxyFetch(r)
    : Promise.resolve({ url: r.url, status: 0, text: '', blocked: false, truncated: false, error: this.offsite(r.url), ms: 0 }));

  activeMs() { return this.st.active_ms + (Date.now() - this.callStart); }
  totalMs() { return Math.min(this.st.minutes, MAX_MINUTES) * 60_000; }
  researchEndMs() { return this.totalMs() - Math.min(SUBMIT_RESERVE_MS, this.totalMs() * 0.25); }
  remaining() { return this.researchEndMs() - this.activeMs(); }
  log(line: string) { this.st.log.push(line.slice(0, 400)); if (this.st.log.length > 300) this.st.log.splice(0, this.st.log.length - 300); }

  takeFetch() {
    if (this.remaining() < 10_000) throw new LimitReached('research time is over - submit the best config you have validated (or give_up)');
    if (this.st.fetches >= this.st.max_fetches) throw new LimitReached(`research fetch budget used up (${this.st.fetches}/${this.st.max_fetches}) - inspect stored responses, then test_source / coverage_check / submit_config`);
    this.st.fetches++;
  }
  toolDeadline(tool: string): number {
    const callEnd = this.callDeadline - 5_000;
    if (tool === 'submit_config') return Math.min(Date.now() + TOOL_CAPS[tool], callEnd);
    if (this.remaining() < 10_000) throw new LimitReached('research time is over - submit the best config you have validated (or give_up)');
    return Math.min(Date.now() + TOOL_CAPS[tool], Date.now() + this.remaining(), callEnd);
  }
  fetchTimeout(render: boolean) { return Math.max(8_000, Math.min(render ? 90_000 : 45_000, this.remaining(), this.callDeadline - Date.now() - 5_000)); }
  store(url: string, status: number, text: string): string {
    const ref = `r${++this.st.response_count}`;
    this.st.responses.push({ ref, url, status, text: text.slice(0, 400_000) });
    return ref;
  }
  textFor(ref: string): [string, string] {
    const r = this.st.responses.find((x) => x.ref === ref);
    if (r) return [r.text ?? '', r.url];
    const m = /^c(\d+)$/.exec(ref);
    const rec = m && this.browser ? this.browser.records.get(Number(m[1])) : null;
    if (rec) return [rec.body ?? '', rec.url];
    throw new Error(`unknown ref ${ref}`);
  }
  // Fix (v2 browser reconnect, 2026-10-09): the remote browser's connection can drop mid-research
  // (kw.com dry run 3982: "browser connection closed" on every browser step after the first page).
  // A closed browser is reconnected (fresh browser, last page reopened, network records kept), up to
  // 3 times per worker call.
  reconnects = 0;
  async browserReady(): Promise<RemoteBrowser> {
    const cur = this.b();
    if (!cur.closed) return cur;
    if (this.reconnects >= 3) throw new BrowserError('browser connection closed (reconnected 3 times in this call already)');
    this.reconnects++;
    const saved = cur.exportState();
    try {
      this.browser = await RemoteBrowser.connect(saved, saved.session_name);
      this.log(`browser reconnected (${this.reconnects})`);
      return this.browser;
    } catch (e) {
      this.st.browser_error = String((e as Error)?.message ?? e).slice(0, 300);
      throw new BrowserError(`browser connection closed and could not be reopened: ${this.st.browser_error}`);
    }
  }
  b(): RemoteBrowser {
    if (!this.browser) throw new BrowserError(`the browser is not available in this run${this.st.browser_error ? ` (${this.st.browser_error})` : ''} - use http_fetch`);
    return this.browser;
  }

  // ---- tools ----------------------------------------------------------------------------
  async t_sitemap_probe(a: any) {
    const out: any = {};
    if (a.url && !this.onSite(a.url)) throw new Error(this.offsite(a.url));
    let targets: string[] = a.url ? [a.url] : [];
    const origin = new URL(this.st.start_url).origin;
    if (!a.url) {
      this.takeFetch();
      const robots = await this.siteFetch({ method: 'GET', url: `${origin}/robots.txt`, timeoutMs: this.fetchTimeout(false) });
      const found = robots.status === 200 ? [...robots.text.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]) : [];
      out.robots_status = robots.status || robots.error;
      out.robots_sitemaps = found;
      out.robots_disallow_sample = [...robots.text.matchAll(/^\s*disallow:\s*(\S+)/gim)].map((m) => m[1]).slice(0, 12);
      targets = found.slice(0, 2).length ? found.slice(0, 2) : [`${origin}/sitemap.xml`];
    }
    out.sitemaps = [];
    for (const t of targets.slice(0, 2)) {
      this.takeFetch();
      const resp = await this.siteFetch({ method: 'GET', url: t, maxBytes: SITEMAP_SAMPLE_BYTES, timeoutMs: this.fetchTimeout(false) });
      const locs = [...resp.text.matchAll(E.LOC_RE)].map((m) => m[1]);
      const entry: any = { url: t, status: resp.status || resp.error, locs_in_sample: locs.length, sampled: resp.truncated };
      if (/<sitemapindex/i.test(resp.text.slice(0, 2000))) Object.assign(entry, { type: 'sitemap index', children: locs.slice(0, 50) });
      else {
        const groups = new Map<string, { count: number; examples: string[] }>();
        for (const l of locs) {
          const p = E.urlPattern(l);
          const g = groups.get(p) ?? { count: 0, examples: [] };
          g.count++;
          if (g.examples.length < 2) g.examples.push(l);
          groups.set(p, g);
        }
        entry.type = 'url set';
        entry.url_patterns = [...groups.entries()].sort((x, y) => y[1].count - x[1].count).slice(0, 10).map(([p, g]) => [p, g.count, g.examples]);
      }
      out.sitemaps.push(entry);
    }
    return out;
  }

  async t_http_fetch(a: any) {
    let { url, method, headers, body } = a;
    if (a.replay) {
      const rec = this.b().records.get(Number(String(a.replay).replace(/^c/, '')));
      if (!rec) throw new Error(`unknown browser record ${a.replay}`);
      url = url || rec.url;
      method = method || rec.method;
      headers = { ...cleanHeaders(rec.request_headers), ...(headers ?? {}) };
      body = body ?? rec.post_data ?? null;
    }
    if (!url) throw new Error('http_fetch needs url or replay');
    if (!this.onSite(url)) throw new Error(this.offsite(url));
    method = String(method || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET';
    this.takeFetch();
    const render = !!a.render;
    const partial = method === 'GET' && /\.xml(\.gz)?$|sitemap/i.test(new URL(url).pathname) ? SITEMAP_SAMPLE_BYTES : undefined;
    const resp = await this.siteFetch({ method, url, headers: headers ?? {}, body: method === 'POST' ? body ?? null : null, render, maxBytes: partial, timeoutMs: this.fetchTimeout(render) });
    const ref = this.store(resp.url, resp.status, resp.text);
    const seconds = Math.round(resp.ms / 1000);
    if (resp.error || resp.blocked || resp.status >= 400) {
      const out: any = { ref, status: resp.status, error: resp.error ?? (resp.blocked ? 'bot challenge / blocked' : `HTTP ${resp.status}`), seconds, body_start: E.clip(resp.text, 500) };
      const hint = this.hint(method, url, resp);
      if (hint) out.hint = hint;
      if (hint?.startsWith('API') && this.browser && !this.st.key_search_done) {
        this.st.key_search_done = true;
        try {
          const found: any = await this.t_search_scripts({ pattern: `["']x-[a-z0-9-]*(?:key|token|auth)[a-z0-9-]*["']\\s*:\\s*["'][^"']{8,}|api[-_]?key["']?\\s*[:=]\\s*["'][^"']{8,}`, max_files: 40, prefer: E.hostOf(url) });
          out.auto_script_search_for_keys = found.hits?.slice(0, 6)?.length ? found.hits.slice(0, 6) : 'no key-like headers found in the JS bundles';
        } catch { /* budget */ }
      }
      return out;
    }
    const ctype = /^\s*[[{]/.test(resp.text) ? 'application/json' : '';
    return {
      ref, status: resp.status, seconds, final_url: resp.url, bytes: resp.text.length, sampled_first_bytes_only: resp.truncated, blocked: resp.blocked,
      ...(a.replay ? { sent_headers: Object.fromEntries(Object.entries(headers ?? {}).map(([k, v]) => [k, E.clip(String(v), 80)])) } : {}),
      summary: E.summarizeBody(resp.url, ctype, resp.text),
    };
  }
  hint(method: string, url: string, resp: E.EngineResponse): string | null {
    if (method === 'POST' || url.includes('graphql') || url.includes('/api')) {
      if ((resp.error && /timed out/i.test(resp.error)) || [401, 403].includes(resp.status)) {
        return 'API calls that work in the browser but fail here usually need a key or header defined in the site\'s JavaScript: search_scripts(pattern=\'api[-_]?key|x-[a-z-]+-key|authorization\') and add it to the headers; also try http_fetch replay=\'cN\' of the browser\'s own call.';
      }
    } else if (this.browser && [...this.browser.records.values()].some((r) => ['XHR', 'Fetch'].includes(r.type) && /json/.test(r.mime_type ?? ''))) {
      return 'This HTML is bot-protected. The browser saw JSON data calls (network_log all=true) - replay one with http_fetch replay=\'cN\'; APIs usually work without render, which is slow and costly.';
    }
    return null;
  }

  async t_inspect(a: any) {
    const [text, url] = this.textFor(a.ref);
    const limit = Math.max(1, Math.min(Number(a.limit ?? 30) || 30, 100));
    if (a.css) {
      if (/^\s*[[{]/.test(text)) return { error: 'body is JSON; use jsonpath' };
      const values = E.cssValues(text, a.css);
      return { count: values.length, values: values.slice(0, limit).map((v) => E.clip(v, 250)) };
    }
    if (a.jsonpath) {
      const data = a.embedded_css ? E.embeddedJson(text, a.embedded_css) : E.parseJson(text);
      const values = data !== undefined ? E.jsonpath(data, a.jsonpath) : [];
      return { count: values.length, values: values.slice(0, limit).map((v) => E.clip(JSON.stringify(E.trimJson(v, 120, 3, 4)), 350)) };
    }
    if (a.regex) {
      const values = [...text.matchAll(new RegExp(a.regex, 'g'))].map((m) => m[1] ?? m[0]);
      return { count: values.length, values: values.slice(0, limit).map((v) => E.clip(String(v), 250)) };
    }
    if (a.search) {
      const hits: number[] = [];
      let i = text.indexOf(a.search);
      while (i >= 0 && hits.length < 200) { hits.push(i); i = text.indexOf(a.search, i + 1); }
      return { count: hits.length, snippets: hits.slice(0, Math.min(limit, 6)).map((h) => text.slice(Math.max(0, h - 180), h + 220)) };
    }
    return { url, bytes: text.length, summary: E.summarizeBody(url, '', text) };
  }

  needsBrowserEvidence(): string | null {
    if (this.browser && this.st.browser_actions < 2 && this.remaining() > 45_000) {
      return 'First look at the listing in the browser: open a results page (city / search / directory), go to page 2 or run a search, and check its DATA CALLS for an API and for page caps. Then decide.';
    }
    return null;
  }
  async pageView(): Promise<string> {
    this.st.browser_actions++;
    const calls = this.t_network_log({}).requests as string[];
    const head = calls.length
      ? `DATA CALLS this action triggered (network_detail cN / http_fetch replay=cN):\n${calls.slice(-15).join('\n')}`
      : 'DATA CALLS: none (results are in the HTML, or load on scroll/search)';
    const restarted = this.browser?.restarted ? 'NOTE: the browser session was restarted; the last page was reopened.\n' : '';
    if (this.browser) this.browser.restarted = false;
    return `${restarted}${head}\n\n${await (await this.browserReady()).snapshot(70, 1_200)}`;
  }
  async t_browser_open(a: any) {
    if (!this.onSite(String(a.url))) throw new Error(this.offsite(String(a.url)));
    await (await this.browserReady()).open(String(a.url));
    return this.pageView();
  }
  async t_browser_snapshot() { await this.browserReady(); return this.pageView(); }
  async t_browser_click(a: any) { await (await this.browserReady()).click(Number(a.element)); return this.pageView(); }
  async t_browser_type(a: any) { await (await this.browserReady()).type(Number(a.element), String(a.text ?? ''), !!a.submit); return this.pageView(); }
  async t_browser_scroll(a: any) { await (await this.browserReady()).scroll(a.direction === 'up' ? 'up' : 'down'); return this.pageView(); }
  async t_browser_back() { await (await this.browserReady()).back(); return this.pageView(); }

  t_network_log(a: any) {
    const b = this.b();
    const seqs = a.all ? [...b.records.keys()].sort((x, y) => x - y) : [...b.unread];
    b.unread = [];
    const lines: string[] = [];
    let skipped = 0;
    let offsite = 0;
    for (const seq of seqs) {
      const r = b.records.get(seq);
      if (!r) continue;
      if (!this.onSite(r.url)) { offsite++; continue; }
      const dataCall = ['XHR', 'Fetch', 'Other'].includes(r.type);
      if (!(dataCall || r.type === 'Document') || (a.filter && !r.url.includes(a.filter))) { skipped++; continue; }
      const op = /"operationName"\s*:\s*"([^"]+)"/.exec(r.post_data ?? '');
      lines.push(`c${seq} ${r.method} ${r.status ?? ''} ${r.type} ${E.clip(r.url, 200)} ${r.mime_type ?? ''} ${(r.body ?? '').length}B${op ? ` op=${op[1]}` : ''}`);
    }
    return { navigations: b.navigations.slice(-6), requests: lines.slice(-60), skipped, ...(offsite ? { third_party_calls_hidden: offsite } : {}) };
  }

  async t_search_scripts(a: any) {
    const rx = new RegExp(a.pattern, 'gi');
    const site = this.st.domain.replace(/^www\./, '');
    let urls = this.b().scripts.filter((u) => this.onSite(u) && (!a.url_filter || new RegExp(a.url_filter, 'i').test(u)));
    urls = urls.sort((x, y) => Number(!E.hostOf(x).endsWith(site)) - Number(!E.hostOf(y).endsWith(site))).slice(0, Math.max(1, Math.min(Number(a.max_files ?? 40) || 40, 40)));
    for (let i = 0; i < Math.max(1, Math.floor(urls.length / 10)); i++) this.takeFetch();
    const deadline = this.toolDeadline('search_scripts');
    const hits: any[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < urls.length && Date.now() < deadline; i += 8) {
      const batch = await Promise.all(urls.slice(i, i + 8).map(async (u) => [u, (await this.siteFetch({ method: 'GET', url: u, timeoutMs: Math.max(5_000, Math.min(30_000, deadline - Date.now())) })).text] as [string, string]));
      for (const [u, text] of batch) {
        for (const m of text.matchAll(rx)) {
          const ctx = text.slice(Math.max(0, (m.index ?? 0) - 150), (m.index ?? 0) + m[0].length + 150);
          if (seen.has(ctx)) continue;
          seen.add(ctx);
          hits.push({ script: E.clip(u, 110), match: m[0].slice(0, 100), context: ctx });
          if (hits.length > 60) break;
        }
      }
    }
    if (a.prefer) hits.sort((x, y) => Number(!/["']x-[a-z0-9-]+["']\s*:/i.test(x.context)) - Number(!/["']x-[a-z0-9-]+["']\s*:/i.test(y.context)) || Number(!x.context.includes(a.prefer)) - Number(!y.context.includes(a.prefer)));
    return { scripts_known: this.b().scripts.length, searched: urls.length, hits: hits.slice(0, 12) };
  }

  t_network_detail(a: any) {
    const r: NetRecord | undefined = this.b().records.get(Number(a.seq));
    if (!r) return { error: `c${a.seq} not found (it may still be loading)` };
    return {
      ref: `c${r.seq}`, method: r.method, url: r.url, status: r.status, type: r.type,
      request_headers: Object.fromEntries(Object.entries(r.request_headers ?? {}).map(([k, v]) => [k, E.clip(String(v), 180)])),
      post_data: E.clip(r.post_data ?? null, 2_500),
      response_headers: Object.fromEntries(Object.entries(r.response_headers ?? {}).map(([k, v]) => [k, E.clip(String(v), 150)])),
      body: E.summarizeBody(r.url, r.mime_type ?? '', r.body ?? ''),
    };
  }

  configWith(sources: any[], settings?: any) {
    if (settings && typeof settings === 'object') Object.assign(this.st.settings, settings);
    return { ...this.st.settings, start_url: this.st.settings.start_url || this.st.start_url, sources };
  }
  sourceKey(cfg: any, src: any): string {
    const { name: _n, ...rest } = src;
    const settings = { render: !!cfg.render, headers: cfg.headers ?? {}, profile_url_pattern: cfg.profile_url_pattern ?? null, strip_query: !!cfg.strip_query };
    return stable([rest, settings]);
  }
  remember(cfg: any, src: any, summary: any) {
    if (summary.new_unique > 0 && !summary.rejected_by_profile_pattern) this.st.proven[this.sourceKey(cfg, src)] = summary;
  }
  async sample(cfg: any, deadline: number, sample?: number, reuse = false): Promise<any[]> {
    const out: any[] = [];
    for (const src of cfg.sources) {
      const known = reuse ? this.st.proven[this.sourceKey(cfg, src)] : null;
      if (known) { out.push({ ...known, source: src.name, reused_from_earlier_test: true }); continue; }
      const limits: E.Limits = { workers: 4, deadline, sitemapBytes: SITEMAP_SAMPLE_BYTES, ...(TEST_LIMITS[src.type] ?? {}) };
      if (sample) {
        const n = Math.max(1, Math.min(Number(sample), 20));
        if (limits.maxSeeds) limits.maxSeeds = n;
        if (limits.maxRequests) limits.maxRequests = n;
      }
      const render = !!('render' in src ? src.render : cfg.render);
      const timeout = Math.max(5_000, Math.min(render ? 90_000 : 45_000, deadline - Date.now()));
      const stats = (await E.runConfig({ ...cfg, sources: [src] }, new E.Collector(cfg), limits, this.siteFetch, timeout))[0];
      const summary = stats.summary();
      this.remember(cfg, src, summary);
      out.push(summary);
    }
    return out;
  }
  async t_test_source(a: any) {
    const { cfg, problems } = E.normalizeConfig({ ...this.configWith([{ name: a.source?.name || 'test', ...(a.source ?? {}) }], a.settings), domain: this.st.domain });
    if (problems.length) return { config_problems: problems };
    return (await this.sample(cfg, this.toolDeadline('test_source'), a.sample))[0];
  }
  async t_coverage_check(a: any): Promise<any> {
    const source = { name: a.source?.name || 'coverage', ...(a.source ?? {}) };
    const { cfg, problems } = E.normalizeConfig({ ...this.configWith([source], a.settings), domain: this.st.domain });
    if (problems.length) return { config_problems: problems };
    const collector = new E.Collector(cfg);
    const probes = new Set<string>((a.probe_urls ?? []).slice(0, 40).map((u: string) => collector.normalize(u)));
    if (probes.size < 10) return [{ error: `only ${probes.size} probe URLs; collect at least 10 from different pages` }, true];
    const deadline = this.toolDeadline('coverage_check');
    // Fix (coverage reads whole sitemaps, 2026-10-09): the coverage check reads whole sitemap files
    // (up to 6); with the 400 KB research sample, probes later in a file counted as missing
    // (compass.com 8.3%, remax.com 0%, morganstanley.com 0%).
    const limits: E.Limits = {
      workers: 8, deadline,
      maxPages: Math.max(1, Math.min(Number(a.max_pages ?? 3) || 3, 20)), maxSeeds: Math.max(1, Math.min(Number(a.max_seeds ?? 12) || 12, 30)),
      maxRequests: source.type === 'sitemap' ? 6 : 120,
    };
    const render = !!('render' in source ? source.render : cfg.render);
    const stats = (await E.runConfig(cfg, collector, limits, this.siteFetch, Math.max(5_000, Math.min(render ? 90_000 : 45_000, deadline - Date.now()))))[0];
    this.remember(cfg, cfg.sources[0], stats.summary());
    const hit = [...probes].filter((u) => collector.seen.has(u));
    const percent = Math.round((1000 * hit.length) / probes.size) / 10;
    this.st.coverage[source.name] = percent;
    return {
      probe_urls: probes.size, contained: hit.length, coverage_percent: percent,
      missing_examples: [...probes].filter((u) => !collector.seen.has(u)).sort().slice(0, 8),
      note: 'partial runs of looped sources under-count', source_stats: stats.summary(),
    };
  }
  async profileLoads(url: string, cfg: any): Promise<{ problem: string | null; html: string }> {
    for (const render of [...new Set([!!cfg.render, true])]) {
      const left = this.callDeadline - 10_000 - Date.now();
      if (left < 8_000) return { problem: null, html: '' };
      const resp = await this.siteFetch({ method: 'GET', url, render, timeoutMs: Math.min(40_000, left) });
      if (resp.status === 200) return { problem: null, html: resp.text };
      if (resp.status === 404 || resp.status === 410) return { problem: `sample profile ${url} does not exist (HTTP ${resp.status})`, html: '' };
    }
    return { problem: null, html: '' };
  }
  // Fix (person pages for person categories, 2026-10-09): schwab.com and fidelity.com configs collected
  // branch pages for "financial advisor". The submitted sample profile page is now read by one short
  // AI check (one person / one office or branch / a list / other) against the category; a branch page
  // for a person category, or a person page for an office category, is refused.
  personCategory(): boolean {
    return !/office|branch|location|store|restaurant|clinic|hospital|dealer|bank|hotel|school|shop|salon|gym|pharmacy|cent(?:er|re)|compan|firm|agenc|brokerage/i.test(this.st.category_label);
  }
  async pageKind(url: string, html: string, apiKey: string): Promise<{ kind: string; reason: string } | null> {
    if (!html) return null;
    const types = [...html.matchAll(/"@type"\s*:\s*(\[[^\]]*\]|"[^"]+")/g)].map((m) => m[1]).slice(0, 12).join(' ');
    const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').trim().slice(0, 200);
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4_000);
    const prompt = `URL: ${url}\nTITLE: ${title}\nJSON-LD TYPES: ${types || 'none'}\nVISIBLE TEXT (start):\n${text}\n\n`
      + 'Is this page about ONE individual person (their own profile), ONE office/branch/location, a LIST of several people or offices, or OTHER? '
      + 'Answer with JSON only: {"kind":"person|office|list|other","reason":"one short sentence"}';
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 30_000);
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: ctl.signal,
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.st.model, max_tokens: 200, messages: [{ role: 'user', content: prompt }] }),
      }).finally(() => clearTimeout(timer));
      if (!res.ok) return null;
      const body: any = await res.json();
      this.account(body.usage);
      const out = (body.content ?? []).map((b: any) => b.text ?? '').join('');
      const j = E.parseJson(/\{[\s\S]*\}/.exec(out)?.[0] ?? '');
      return j?.kind ? { kind: String(j.kind), reason: String(j.reason ?? '') } : null;
    } catch { return null; }
  }
  apiKey = '';
  async t_submit_config(a: any): Promise<any> {
    const evidence = this.needsBrowserEvidence();
    if (evidence) return [{ refused: evidence }, true];
    const { cfg, problems } = E.normalizeConfig({ version: 2, ...(a.config ?? {}), domain: this.st.domain });
    if (!cfg.profile_url_pattern) problems.push('profile_url_pattern is required');
    if (cfg.start_url && !this.onSite(cfg.start_url)) problems.push(this.offsite(cfg.start_url));
    // Fix (complete lists in the config, 2026-10-09): a short hand-picked list (e.g. 18 cities on
    // realtor.com) is fine for testing, but the config is what harvesting runs, so it must cover the
    // whole site: systematic seeds (us_states, alphabet, ranges, values extracted from the site's own
    // hub pages) or one hub page that is followed. A short list passes only with complete_list_reason.
    if (!String(a.complete_list_reason ?? '').trim()) {
      for (const src of cfg.sources) {
        for (const [name, seed] of Object.entries<any>(src.seeds ?? {})) {
          if (seed?.type === 'list' && Array.isArray(seed.values) && seed.values.length < 100) {
            problems.push(`source ${src.name}: seed '${name}' is a hand-picked list of ${seed.values.length} values; the config must cover the whole site - use systematic seeds (us_states, alphabet with expand_at, range, or values extracted from the site's own hub pages), or pass complete_list_reason if this list is the site's complete set`);
          }
        }
        if (src.type === 'link_crawl' && Array.isArray(src.start_urls) && src.start_urls.length > 3) {
          problems.push(`source ${src.name}: ${src.start_urls.length} hand-picked start URLs; start from the site's hub page(s) that list every area and follow them (follow regex), or pass complete_list_reason if these are all the hubs`);
        }
      }
    }
    const values = Object.values(this.st.coverage);
    const best = values.length ? Math.max(...values) : null;
    if (best == null && this.remaining() > 60_000) problems.push('run coverage_check first (profile URLs from an independent path, e.g. directory pages)');
    else if (best != null && best < 90 && !String(a.coverage_justification ?? '').trim()) problems.push(`best coverage is ${best}% (< 90%): improve it, or resubmit with coverage_justification`);
    if (problems.length) return [{ validation_failed: problems }, true];
    const proven = cfg.sources.every((s: any) => this.sourceKey(cfg, s) in this.st.proven);
    this.st.pending = { config: cfg, report: a.report_markdown, proven, coverage_justification: a.coverage_justification ?? null };
    const stats = await this.sample(cfg, this.toolDeadline('submit_config'), undefined, true);
    const bad = stats.filter((s) => !s.new_unique).map((s) => `source ${s.source} produced no profile URLs: errors=${JSON.stringify(s.errors?.slice(0, 2))} stops=${JSON.stringify(s.stop_reasons)} rejected=${JSON.stringify(s.rejected_samples?.slice(0, 3))}`);
    const sampleUrl = stats.flatMap((s) => s.sample_urls ?? [])[0];
    if (sampleUrl && !bad.length) {
      const loaded = await this.profileLoads(sampleUrl, cfg);
      if (loaded.problem) bad.push(loaded.problem);
      else if (loaded.html) {
        const kind = await this.pageKind(sampleUrl, loaded.html, this.apiKey);
        const person = this.personCategory();
        if (kind && person && kind.kind !== 'person') bad.push(`the sample profile ${sampleUrl} looks like ${kind.kind === 'office' ? 'an office / branch page' : kind.kind === 'list' ? 'a list page' : 'not a profile page'} (${kind.reason}); the category "${this.st.category_label}" needs one page per individual person - look for the site's individual profile pages`);
        if (kind && !person && !['office', 'person'].includes(kind.kind)) bad.push(`the sample profile ${sampleUrl} does not look like one office or business page (${kind.reason})`);
        if (kind) this.log(`sample page check: ${kind.kind} (${kind.reason.slice(0, 120)})`);
      }
    }
    if (bad.length) return [{ validation_failed: bad, source_stats: stats }, true];
    this.st.result = { outcome: 'config', config: cfg, report_markdown: a.report_markdown, coverage_justification: a.coverage_justification ?? null, validation: stats };
    this.st.pending = null;
    return { accepted: true };
  }
  async t_give_up(a: any): Promise<any> {
    const used = this.activeMs() / Math.max(1, this.researchEndMs());
    if (this.needsBrowserEvidence() || used < 0.6) {
      return [{ refused: 'Too early to give up. Keep researching: follow the site\'s own navigation/search links (not guessed URLs), open the directory in the browser and read its DATA CALLS, look for keys the API needs (search_scripts), and check the sitemap. Give up only when those all fail.' }, true];
    }
    this.st.result = { outcome: 'gave_up', reason: a.reason, report_markdown: a.report_markdown };
    return { stopped: true };
  }

  async callTool(name: string, args: any): Promise<[string, boolean]> {
    const fn = (this as any)[`t_${name}`];
    if (typeof fn !== 'function') return [`unknown tool ${name}`, true];
    try {
      let out = await fn.call(this, args ?? {});
      let isError = false;
      if (Array.isArray(out) && out.length === 2 && typeof out[1] === 'boolean') [out, isError] = out as [any, boolean];
      const text = typeof out === 'string' ? out : JSON.stringify(out);
      return [text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}… [truncated ${text.length - MAX_RESULT_CHARS} chars; use inspect]` : text, isError];
    } catch (e) {
      if (e instanceof LimitReached) return [`Limit: ${e.message}`, true];
      return [`${(e as Error)?.name ?? 'Error'}: ${String((e as Error)?.message ?? e).slice(0, 300)}`, true];
    }
  }

  // ---- model ----------------------------------------------------------------------------
  account(usage: any) {
    const price = PRICES[this.st.model] ?? PRICES[DEFAULT_MODEL];
    const inp = usage?.input_tokens ?? 0;
    const cr = usage?.cache_read_input_tokens ?? 0;
    const cw = usage?.cache_creation_input_tokens ?? 0;
    const outp = usage?.output_tokens ?? 0;
    this.st.tokens.input = (this.st.tokens.input ?? 0) + inp;
    this.st.tokens.cache_read = (this.st.tokens.cache_read ?? 0) + cr;
    this.st.tokens.cache_write = (this.st.tokens.cache_write ?? 0) + cw;
    this.st.tokens.output = (this.st.tokens.output ?? 0) + outp;
    this.st.cost += (inp * price[0] + cr * price[1] + cw * price[2] + outp * price[3]) / 1e6;
    // ETL AI cost log (2026-10-22): one row per research call, written when the worker request ends.
    noteAiUsage({ model: this.st.model, usage, activity: 'map_research', step: 'research' });
  }
  async callModel(apiKey: string, timeoutMs: number): Promise<any> {
    const msgs = this.st.messages.map((m, i) => {
      if (i !== this.st.messages.length - 1 || m.role !== 'user') return m;
      const content = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : [...m.content];
      content[content.length - 1] = { ...content[content.length - 1], cache_control: { type: 'ephemeral' } };
      return { ...m, content };
    });
    const tools = TOOLS.map((t, i) => (i === TOOLS.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t));
    for (let attempt = 0; attempt < 3; attempt++) {
      const body: any = { model: this.st.model, max_tokens: 8_000, system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }], tools, messages: msgs };
      if (this.st.effort) body.output_config = { effort: this.st.effort };
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), Math.max(10_000, timeoutMs));
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctl.signal,
        });
        const text = await res.text();
        if (res.ok) return JSON.parse(text);
        if (res.status === 400 && this.st.effort && /output_config|effort/i.test(text)) { this.log(`model: effort not accepted, retrying without (${text.slice(0, 120)})`); this.st.effort = null; continue; }
        if ([429, 500, 502, 503, 529].includes(res.status) && attempt < 2) { await new Promise((r) => setTimeout(r, 3_000 * (attempt + 1))); continue; }
        throw new Error(`anthropic ${res.status}: ${text.slice(0, 400)}`);
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error('anthropic: no response');
  }
  notice(): string | null {
    const used = this.activeMs() / Math.max(1, this.researchEndMs());
    const checks: Array<[string, boolean, string]> = [
      ['submit_now', used >= 1, 'Research time is over. Call submit_config now with the best config you have validated (or give_up with a report).'],
      ['half_time', used >= 0.5, 'Halfway through the research time. Stop exploring alternatives: test your best method, run one coverage_check and submit.'],
      ['half_cost', this.st.cost >= this.st.budget * 0.5, `Half of the $${this.st.budget.toFixed(2)} cost cap is used. Converge now: test, check coverage once, submit.`],
      ['fetches', this.st.fetches >= this.st.max_fetches * 0.75, 'Most research fetches are used. Use inspect on stored responses and finish with test_source / coverage_check / submit_config.'],
    ];
    for (const [key, cond, text] of checks) {
      if (cond && !this.st.notices.includes(key)) { this.st.notices.push(key); return text; }
    }
    return null;
  }
  firstMessage(snapshot: string): string {
    return [
      `Website: ${this.st.start_url}`,
      `Category (map profile pages of this kind only): ${this.st.category_label} (${this.st.category})`,
      `Limits: $${this.st.budget.toFixed(2)} cost cap (aim for well under half), ${Math.min(this.st.minutes, MAX_MINUTES)} minutes of research time in total (the last ${Math.round(Math.min(SUBMIT_RESERVE_MS, this.totalMs() * 0.25) / 1000)} s are kept for submit_config), ${this.st.max_fetches} research fetches.`,
      '',
      this.browser ? 'The browser has opened the start page:' : 'Browser:',
      snapshot,
      '',
      'Research the site and deliver the crawler config.',
    ].join('\n');
  }

  async executeCalls(calls: any[]): Promise<any[]> {
    for (const c of calls) this.log(`-> ${c.name} ${E.clip(JSON.stringify(c.input ?? {}), 150)}`);
    const outputs: Array<[string, boolean]> = calls.length > 1 && calls.every((c) => PARALLEL_TOOLS.has(c.name))
      ? await Promise.all(calls.map((c) => this.callTool(c.name, c.input)))
      : await (async () => { const o: Array<[string, boolean]> = []; for (const c of calls) o.push(await this.callTool(c.name, c.input)); return o; })();
    return calls.map((c, i) => {
      const [text, isError] = outputs[i];
      if (isError) this.log(`   ! ${E.clip(text, 180)}`);
      return { type: 'tool_result', tool_use_id: c.id, content: text, is_error: isError };
    });
  }

  /** One worker call of research. Returns when the research is finished or this call's time is used. */
  async run(apiKey: string): Promise<void> {
    const st = this.st;
    this.apiKey = apiKey;
    st.other_domains ??= {};
    st.calls++;
    if (st.use_browser) {
      try {
        this.browser = await RemoteBrowser.connect(st.browser, st.browser?.session_name ?? `disco-agent-${st.domain.replace(/[^a-z0-9]/gi, '-')}-${Date.now()}`);
        st.browser_error = null;
      } catch (e) {
        st.browser_error = String((e as Error)?.message ?? e).slice(0, 300);
        this.log(`browser unavailable: ${st.browser_error}`);
        this.browser = null;
      }
    }
    try {
      if (!st.messages.length) {
        let snapshot = '(browser unavailable - use http_fetch)';
        if (this.browser) {
          try { await this.browser.open(st.start_url); snapshot = await this.pageView(); st.browser_actions = 0; }
          catch (e) { snapshot = `(the start page did not open in the browser: ${String((e as Error)?.message ?? e).slice(0, 200)})`; }
        }
        st.messages.push({ role: 'user', content: this.firstMessage(snapshot) });
      }
      if (st.pending_calls?.length) {
        const results = await this.executeCalls(st.pending_calls);
        st.pending_calls = null;
        st.messages.push({ role: 'user', content: results });
      }
      while (!st.result) {
        if (this.activeMs() > this.totalMs()) { this.log('hard time limit reached'); break; }
        if (st.cost >= st.budget) { this.log('cost cap reached'); break; }
        if (this.callDeadline - Date.now() < 45_000) return;   // continue in the next call
        const msg = await this.callModel(apiKey, Math.min(120_000, this.callDeadline - Date.now() - 10_000));
        this.account(msg.usage);
        st.messages.push({ role: 'assistant', content: msg.content });
        for (const block of msg.content ?? []) if (block.type === 'text' && block.text?.trim()) this.log(`[AI] ${block.text.trim()}`);
        if (msg.stop_reason === 'refusal') { st.result = { outcome: 'stopped', reason: 'Claude declined the request' }; break; }
        const calls = (msg.content ?? []).filter((b: any) => b.type === 'tool_use');
        st.turns++;
        if (!calls.length) {
          if (st.nudges >= 2) { this.log('no tool calls after two reminders'); break; }
          st.nudges++;
          st.messages.push({ role: 'user', content: 'Continue with the tools. Finish with submit_config or give_up.' });
          continue;
        }
        const heavy = calls.some((c: any) => HEAVY_TOOLS.has(c.name) || c.name.startsWith('browser_'));
        if (heavy && this.callDeadline - Date.now() < 100_000) { st.pending_calls = calls; return; }
        const results = await this.executeCalls(calls);
        const notice = this.notice();
        st.messages.push({ role: 'user', content: notice ? [...results, { type: 'text', text: notice }] : results });
        this.log(`   turn ${st.turns}, ${(this.activeMs() / 60_000).toFixed(1)} min active, $${st.cost.toFixed(2)}`);
      }
      if (!st.result) {
        st.result = st.pending?.proven
          ? { outcome: 'config', config: st.pending.config, report_markdown: `${st.pending.report ?? ''}\n\n**Note:** the time or cost limit was reached during the final check of this config. Every source had already produced profile URLs in test_source / coverage_check, so it was kept; the sample profile page was not re-checked.`, validation: null }
          : { outcome: 'stopped', reason: this.activeMs() > this.totalMs() ? 'time limit reached' : st.cost >= st.budget ? 'cost cap reached' : 'stopped without a config' };
      }
    } finally {
      st.active_ms += Date.now() - this.callStart;
      if (this.browser) { st.browser = this.browser.exportState(); this.browser.close(); }
      if (st.responses.length > 12) st.responses = st.responses.slice(-12);
      st.responses = st.responses.map((r) => ({ ...r, text: r.text.slice(0, 120_000) }));
    }
  }
}

function newState(body: any): AgentState {
  const domain = String(body.domain).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const startUrl = typeof body.start_url === 'string' && /^https?:\/\//.test(body.start_url) ? body.start_url : `https://www.${domain.replace(/^www\./, '')}/`;
  return {
    v: 1, domain, category: String(body.category ?? ''), category_label: categoryLabel(String(body.category ?? 'profiles')), start_url: startUrl,
    model: typeof body.model === 'string' && body.model ? body.model : DEFAULT_MODEL,
    effort: body.effort === null ? null : typeof body.effort === 'string' ? body.effort : 'high',
    budget: Math.max(0.5, Math.min(Number(body.budget ?? 3) || 3, 5)),
    minutes: Math.max(2, Math.min(Number(body.minutes ?? 8) || 8, MAX_MINUTES)),
    max_fetches: Math.max(10, Math.min(Number(body.max_fetches ?? 40) || 40, 80)),
    use_browser: body.no_browser !== true,
    active_ms: 0, calls: 0, turns: 0, cost: 0, tokens: {}, fetches: 0, browser_actions: 0, key_search_done: false,
    settings: { domain }, coverage: {}, proven: {}, responses: [], response_count: 0, browser: null, browser_error: null,
    messages: [], notices: [], nudges: 0, pending_calls: null, result: null, pending: null, log: [], other_domains: {},
  };
}

// G1 (one mapper behind Map, 2026-10-13): version 2 research as a function for the mapping worker's map job.
// It writes nothing itself; the worker hands the proven profile pages to version 1's field learner and saves
// through the normal save path. One call only (no continuation): a run that does not finish in callMs returns
// outcome 'stopped' and the worker falls back to version 1 alone.
export type V2Research = {
  outcome: string; reason: string | null; config: any | null; profile_urls: string[]; sample_pool: number;
  cost_usd: number; active_seconds: number; coverage: Record<string, number>; coverage_justification: string | null;
  flags: unknown; error: string | null; log: string[];
};
/** Up to n URLs spread over the site's sections (path without the last two parts, e.g. office / city), evenly through each section. */
export function spreadProfileUrls(urls: string[], n: number): string[] {
  const groups = new Map<string, string[]>();
  for (const u of [...new Set(urls)]) {
    let key = '';
    try { key = new URL(u).pathname.split('/').filter(Boolean).slice(0, -2).join('/'); } catch { continue; }
    const g = groups.get(key) ?? [];
    g.push(u);
    groups.set(key, g);
  }
  const lists = [...groups.values()].map((g) => {
    const step = Math.max(1, Math.floor(g.length / Math.max(1, Math.ceil(n / Math.max(1, groups.size)))));
    const picked: string[] = [];
    for (let i = 0; i < g.length; i += step) picked.push(g.at(i) as string);
    return picked;
  });
  const out: string[] = [];
  for (let round = 0; out.length < n && lists.some((l) => l.length > round); round++) {
    for (const l of lists) { if (out.length >= n) break; if (l.length > round) out.push(l.at(round) as string); }
  }
  return out;
}
export async function runV2Research(apiKey: string, opts: { domain: string; category: string; start_url?: string; budget?: number; minutes?: number; callMs?: number }): Promise<V2Research> {
  const st = newState({ domain: opts.domain, category: opts.category, start_url: opts.start_url, budget: opts.budget ?? 3, minutes: opts.minutes ?? 8 });
  const ex = new Explorer(st, Math.max(120_000, Math.min(opts.callMs ?? 480_000, 900_000)));
  let error: string | null = null;
  try { await ex.run(apiKey); } catch (e) { error = String((e as Error)?.message ?? e).slice(0, 500); }
  return finishResearch(st, ex, error, 'did not finish within one call');
}
function finishResearch(st: AgentState, ex: Explorer, error: string | null, unfinished: string): V2Research {
  const r = (st.result ?? null) as any;
  const config = r?.outcome === 'config' ? r.config : null;
  const pool = [...new Set(((r?.validation ?? []) as any[]).flatMap((s: any) => s?.sample_urls ?? []).concat(config?.validation?.sample_profile_urls ?? []))]
    .filter((u): u is string => typeof u === 'string');
  return {
    outcome: r?.outcome ?? 'stopped', reason: r?.reason ?? (st.result ? null : unfinished), config,
    profile_urls: config ? spreadProfileUrls(pool, 60) : [], sample_pool: pool.length,
    cost_usd: Math.round(st.cost * 100) / 100, active_seconds: Math.round(st.active_ms / 1000), coverage: st.coverage,
    coverage_justification: r?.coverage_justification ?? null, flags: ex.otherDomainFlags(), error, log: st.log.slice(-40),
  };
}

// Fix (map in steps, 2026-10-14): version 2 research in steps for the mapping worker's map job. The hosting stops a
// request's work when its caller disconnects (5 map requests were left at 'sent' that way) and a 15-minute call
// held the shared pg_net queue (harvest paused 13:11-13:40 UTC on 2026-10-13), so each worker call now runs one
// step of at most V2_STEP_MS and hands back the saved state; the next call continues the same AI conversation
// (all messages, pending tool calls, stored responses, proven sources, cost and time used carry over; the browser
// reopens the last page). The stored copy of the browser's network records is trimmed (STEP_RECORDS records, bodies
// to STEP_BODY characters) so the state kept on the request row stays small. Writes nothing itself.
export const V2_STEP_MS = 240_000;
const V2_MAX_STEPS = 10;                 // safety stop: a run that keeps failing mid-step ends as 'stopped'
const STEP_RECORDS = 40;
const STEP_BODY = 8_000;
export type V2Step =
  | { status: 'continue'; state: unknown; calls: number; turns: number; active_seconds: number; cost_usd: number; log: string[] }
  | { status: 'done'; research: V2Research };
export async function runV2Step(apiKey: string, opts: { domain: string; category: string; start_url?: string; budget?: number; state?: unknown }): Promise<V2Step> {
  const prev = opts.state as AgentState | null | undefined;
  const st: AgentState = prev && typeof prev === 'object' && prev.v === 1 && Array.isArray(prev.messages)
    ? prev
    : newState({ domain: opts.domain, category: opts.category, start_url: opts.start_url, budget: opts.budget ?? 3, minutes: 8 });
  const ex = new Explorer(st, V2_STEP_MS);
  let error: string | null = null;
  try { await ex.run(apiKey); } catch (e) { error = String((e as Error)?.message ?? e).slice(0, 500); ex.log(`call stopped: ${error}`); }
  if (st.result || (error && !st.messages.length) || st.calls >= V2_MAX_STEPS) {
    return { status: 'done', research: finishResearch(st, ex, error, st.calls >= V2_MAX_STEPS ? `stopped after ${V2_MAX_STEPS} steps` : 'stopped without a config') };
  }
  if (st.browser) {
    st.browser = { ...st.browser, records: st.browser.records.slice(-STEP_RECORDS).map((r) => ({
      ...r, body: r.body ? r.body.slice(0, STEP_BODY) : r.body, post_data: r.post_data ? r.post_data.slice(0, 4_000) : r.post_data })) };
  }
  return { status: 'continue', state: st, calls: st.calls, turns: st.turns, active_seconds: Math.round(st.active_ms / 1000), cost_usd: Math.round(st.cost * 100) / 100, log: st.log.slice(-10) };
}

// Fix (no bare 502, 2026-10-09): any error escaping the handler comes back as JSON with its message
// (nar.realtor returned a bare "Internal server error" twice).
async function handle(request: Request): Promise<Response> {
  try {
    return await handleInner(request);
  } catch (e) {
    return Response.json({ dry_run: true, version: 2, status: 'failed', error: String((e as Error)?.stack ?? e).slice(0, 1_500) }, { status: 500 });
  }
}

async function handleInner(request: Request): Promise<Response> {
  const workerKey = process.env['DISCO_WORKER_KEY'];
  if (!workerKey || request.headers.get('x-disco-worker-key') !== workerKey) return new Response('Unauthorized', { status: 401 });
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) return Response.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  let body: any = {};
  try { body = await request.json(); } catch { return Response.json({ error: 'invalid JSON body' }, { status: 400 }); }
  if (body.dry_run !== true) return Response.json({ error: 'version 2 runs as a dry run only (dry_run: true)' }, { status: 400 });
  const st: AgentState = body.state && body.state.v === 1 ? body.state : body.domain ? newState(body) : null as any;
  if (!st) return Response.json({ error: 'domain (or state) is required' }, { status: 400 });
  // Per-call time: 240 s by default. The hosting has no hard limit on request duration (Cloudflare
  // Workers: none while the caller is connected), so a caller may ask for up to 15 minutes per call
  // (call_seconds) and pass a matching pg_net timeout; the research then needs fewer calls.
  const callMs = Math.max(120, Math.min(Number(body.call_seconds ?? CALL_BUDGET_MS / 1000) || CALL_BUDGET_MS / 1000, 900)) * 1000;
  const ex = new Explorer(st, callMs);
  let error: string | null = null;
  try {
    await ex.run(apiKey);
  } catch (e) {
    error = String((e as Error)?.message ?? e).slice(0, 500);
    ex.log(`call stopped: ${error}`);
  }
  const summary = {
    dry_run: true, version: 2, domain: st.domain, category: st.category, model: st.model, calls: st.calls, turns: st.turns,
    active_seconds: Math.round(st.active_ms / 1000), cost_usd: Math.round(st.cost * 100) / 100, tokens: st.tokens, research_fetches: st.fetches,
    browser: { used: st.use_browser, error: st.browser_error, actions: st.browser_actions }, coverage: st.coverage, ...(error ? { error } : {}),
  };
  if (st.result) {
    const flags = ex.otherDomainFlags();
    // Field learning behind version 2 (dry run): the validated profile URLs are handed to the current
    // mapper's field learner (disco-ai-worker dry run with profile_urls), which returns the site contract
    // it would build from them. Nothing is written by either step.
    const profileUrls = [...new Set(((st.result as any).validation ?? []).flatMap((s: any) => s?.sample_urls ?? []))].slice(0, 60) as string[];
    let fieldLearning: Record<string, unknown> | undefined;
    if (body.learn_fields === true && (st.result as any).outcome === 'config' && profileUrls.length) {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 330_000);
        const res = await fetch(new URL('/api/public/disco-ai-worker', request.url).href, {
          method: 'POST', signal: ctl.signal,
          headers: { 'Content-Type': 'application/json', 'x-disco-worker-key': workerKey },
          body: JSON.stringify({ dry_run: true, domain: st.domain, category: st.category, profile_urls: profileUrls }),
        }).finally(() => clearTimeout(timer));
        fieldLearning = (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as Record<string, unknown>;
      } catch (e) {
        fieldLearning = { ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) };
      }
    }
    return Response.json({
      ...summary, status: 'done', ...st.result, profile_urls: profileUrls,
      ...(fieldLearning ? { field_learning: fieldLearning } : {}), ...(flags ? { flags } : {}), log: st.log.slice(-80),
    });
  }
  if (error && !st.messages.length) return Response.json({ ...summary, status: 'failed', log: st.log.slice(-40) });
  return Response.json({ ...summary, status: 'continue', log_tail: st.log.slice(-25), state: st });
}

export const Route = createFileRoute('/api/public/disco-agent-mapper')({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
    },
  },
});
