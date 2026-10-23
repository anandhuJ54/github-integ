// ============================================================================
// disco-webscraper-worker — shared external-website fetch API.
//
// Single place for "fetch a target website through Oxylabs" so callers (the
// disco-ai-worker route today; DB-side scraping functions later, once they can
// reach this endpoint) don't each reimplement proxying, render-fallback, and
// bot-block detection. This endpoint never talks to Anthropic or any other
// first-party API — it only fetches arbitrary external websites.
//
// Trigger: POST /api/public/disco-webscraper-worker with header
// x-disco-worker-key, body { url, crawl_method, render?, fallback_render?,
// geo_location?, user_agent_type? }.
//
// Config reuses the same OXYLABS_* env vars as disco-ai-worker.ts so both
// workers share one Oxylabs configuration surface:
//   Required: OXYLABS_USERNAME, OXYLABS_PASSWORD, DISCO_WORKER_KEY
//   Optional: OXYLABS_ENDPOINT, OXYLABS_GEO_LOCATION, OXYLABS_USER_AGENT_TYPE,
//             OXYLABS_TIMEOUT_MS, OXYLABS_RENDER_TIMEOUT_MS
// ============================================================================
import { createFileRoute } from '@tanstack/react-router';

const OXYLABS_ENDPOINT =
  process.env['OXYLABS_ENDPOINT'] ?? 'https://realtime.oxylabs.io/v1/queries';

const NORMAL_TIMEOUT_MS = Number(process.env['OXYLABS_TIMEOUT_MS'] ?? 60_000);
const RENDER_TIMEOUT_MS = Number(process.env['OXYLABS_RENDER_TIMEOUT_MS'] ?? 180_000);

// Safety default: unless someone explicitly sets FORCE_PROXY=false, every fetch
// keeps going through Oxylabs exactly as before.
const FORCE_PROXY = process.env['FORCE_PROXY'] !== 'false';

export type CrawlMethod = 'server_crawl' | 'needs_proxy' | 'needs_js_api' | 'direct';
const VALID_CRAWL_METHODS: CrawlMethod[] = [
  'server_crawl',
  'needs_proxy',
  'needs_js_api',
  'direct',
];

export interface ScrapeRequest {
  url: string;
  crawl_method: CrawlMethod;
  render?: boolean;
  fallback_render?: boolean;
  geo_location?: string;
  user_agent_type?: string;
}

export interface ScrapeResult {
  ok: boolean;
  url: string;
  /** The URL Oxylabs actually fetched after following redirects, when it differs from `url`. */
  resolved_url: string | null;
  crawl_method: CrawlMethod;
  rendered: boolean;
  attempted_render_fallback: boolean;
  status_code: number | null;
  content: string | null;
  error?: string;
  oxylabs?: { job_id?: string; status?: string; raw?: unknown };
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function validateUrl(value: string): void {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only http:// and https:// URLs are supported');
  }
}

// Anti-bot / transport-failure detection only. This deliberately does NOT
// impose a "content must be at least N characters" business rule — a real
// robots.txt or a small JSON response can legitimately be a handful of bytes.
// Whether a response is *substantial enough for a given caller's purpose*
// (e.g. "does this look like a real company detail page") is caller-specific
// judgment and belongs in the caller (disco-ai-worker's hasEntityData/
// isJsShell), not in this shared fetch layer.
//
// Phrase signals are judged on the page <title> plus the *visible* text of
// small pages only (< 3000 chars of visible text) — never on raw HTML. A plain
// substring test over the whole HTML (scripts included) misfires on normal
// pages: any page embedding a Google reCAPTCHA contact form contains
// "captcha", and Cloudflare injects /cdn-cgi/challenge-platform scripts into
// ordinary pages. Real block/challenge pages are small and say so in their
// title or visible text.
export function looksBlocked(status: number | null, content: string | null): boolean {
  if ([401, 403, 407, 429, 503].includes(status ?? 0)) return true;
  if (content == null || content.trim().length === 0) return true;

  const signals = [
    'captcha',
    'are you a human',
    'access denied',
    'attention required',
    'cf-challenge',
    '/cdn-cgi/challenge-platform',
    'too many requests',
    'request blocked',
    'temporarily blocked',
    'verify you are human',
    'cloudflare ray id',
    'unusual traffic',
  ];

  const titleMatch = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = (titleMatch ? titleMatch[1] : '').toLowerCase().trim();

  const visible = content
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();

  const titleBlocked = signals.some((s) => title.includes(s));
  const visibleBlocked = visible.length < 3000 && signals.some((s) => visible.includes(s));
  return titleBlocked || visibleBlocked;
}

async function oxylabs(
  url: string,
  render: boolean,
  options: Pick<ScrapeRequest, 'geo_location' | 'user_agent_type'>,
) {
  const payload: Record<string, unknown> = {
    source: 'universal',
    url,
  };

  if (render) payload.render = 'html';

  const geoLocation = options.geo_location ?? process.env['OXYLABS_GEO_LOCATION'];
  if (geoLocation) payload.geo_location = geoLocation;

  const userAgentType = options.user_agent_type ?? process.env['OXYLABS_USER_AGENT_TYPE'];
  if (userAgentType) payload.user_agent_type = userAgentType;

  const auth = Buffer
    .from(`${env('OXYLABS_USERNAME')}:${env('OXYLABS_PASSWORD')}`)
    .toString('base64');

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    render ? RENDER_TIMEOUT_MS : NORMAL_TIMEOUT_MS,
  );

  try {
    const response = await fetch(OXYLABS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await response.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`Oxylabs returned non-JSON HTTP ${response.status}`);
    }

    if (!response.ok) {
      throw new Error(
        `Oxylabs HTTP ${response.status}: ${JSON.stringify(body).slice(0, 1000)}`,
      );
    }

    const result = body?.results?.[0];
    if (!result) {
      throw new Error(`Oxylabs returned no result: ${JSON.stringify(body).slice(0, 1000)}`);
    }

    return {
      status_code: typeof result.status_code === 'number' ? result.status_code : null,
      content: typeof result.content === 'string'
        ? result.content
        : result.content == null ? null : JSON.stringify(result.content),
      resolved_url: typeof result.url === 'string' ? result.url : null,
      job_id:
        typeof body?.job_id === 'string'
          ? body.job_id
          : typeof result?.job_id === 'string'
            ? result.job_id
            : undefined,
      status: body?.status,
      raw: body,
    };
  } finally {
    clearTimeout(timer);
  }
}

// A genuine no-proxy fetch straight from this server. Only ever used for
// crawl_method === 'direct' when FORCE_PROXY is explicitly disabled.
async function directFetch(
  url: string,
): Promise<{ status_code: number | null; content: string | null; resolved_url: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NORMAL_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    const text = await response.text();
    return {
      status_code: response.status,
      content: text,
      resolved_url: response.url || url,
    };
  } catch {
    return { status_code: null, content: null, resolved_url: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function scrapeWebsite(request: ScrapeRequest): Promise<ScrapeResult> {
  validateUrl(request.url);

  // 'direct' tries a real no-proxy fetch first, but only when FORCE_PROXY=false.
  // Anything else (and any failure/blocked result) falls through to the exact
  // existing Oxylabs logic, which treats 'direct' like 'server_crawl'.
  if (request.crawl_method === 'direct' && !FORCE_PROXY) {
    const direct = await directFetch(request.url);
    if (
      direct.status_code != null &&
      direct.content != null &&
      direct.content.trim().length > 0 &&
      !looksBlocked(direct.status_code, direct.content)
    ) {
      return {
        ok: true,
        url: request.url,
        resolved_url: direct.resolved_url,
        crawl_method: request.crawl_method,
        rendered: false,
        attempted_render_fallback: false,
        status_code: direct.status_code,
        content: direct.content,
      };
    }
  }

  const initialRender =
    request.render === true || request.crawl_method === 'needs_js_api';

  const allowFallback = request.fallback_render !== false && !initialRender;

  const run = async (render: boolean) => oxylabs(request.url, render, request);

  try {
    let result = await run(initialRender);
    let blocked = looksBlocked(result.status_code, result.content);

    if (blocked && allowFallback) {
      result = await run(true);
      blocked = looksBlocked(result.status_code, result.content);

      return {
        ok: !blocked,
        url: request.url,
        resolved_url: result.resolved_url,
        crawl_method: request.crawl_method,
        rendered: true,
        attempted_render_fallback: true,
        status_code: result.status_code,
        content: result.content,
        ...(blocked ? { error: `Rendered response still blocked/unusable` } : {}),
        oxylabs: {
          job_id: result.job_id,
          status: result.status,
          raw: result.raw,
        },
      };
    }

    return {
      ok: !blocked,
      url: request.url,
      resolved_url: result.resolved_url,
      crawl_method: request.crawl_method,
      rendered: initialRender,
      attempted_render_fallback: false,
      status_code: result.status_code,
      content: result.content,
      ...(blocked ? { error: `Target returned blocked/unusable content` } : {}),
      oxylabs: {
        job_id: result.job_id,
        status: result.status,
        raw: result.raw,
      },
    };
  } catch (error) {
    if (!allowFallback) {
      return {
        ok: false,
        url: request.url,
        resolved_url: null,
        crawl_method: request.crawl_method,
        rendered: initialRender,
        attempted_render_fallback: false,
        status_code: null,
        content: null,
        error: String(error),
      };
    }

    try {
      const result = await run(true);
      const blocked = looksBlocked(result.status_code, result.content);

      return {
        ok: !blocked,
        url: request.url,
        resolved_url: result.resolved_url,
        crawl_method: request.crawl_method,
        rendered: true,
        attempted_render_fallback: true,
        status_code: result.status_code,
        content: result.content,
        ...(blocked ? { error: 'Rendered response still blocked/unusable' } : {}),
        oxylabs: {
          job_id: result.job_id,
          status: result.status,
          raw: result.raw,
        },
      };
    } catch (renderError) {
      return {
        ok: false,
        url: request.url,
        resolved_url: null,
        crawl_method: request.crawl_method,
        rendered: true,
        attempted_render_fallback: true,
        status_code: null,
        content: null,
        error: `normal=${String(error)}; render=${String(renderError)}`,
      };
    }
  }
}

// ---- route-based mapper step 5 (2026-10-07): background calls --------------------------------
// Two additions for disco-ai-worker's mapper. scrapeWebsite above is unchanged, so every existing
// caller behaves exactly as before.
//   captureNetworkCalls: opens a page in Oxylabs' browser (render=html, xhr=true), scrolls to the
//     bottom, clicks a "more" button and the next-page control when present, so lazy-loaded and
//     next-page calls fire, and returns the background calls it made.
//   fetchApiCall: repeats one such call (GET or POST, with a JSON/form body and the page's own
//     non-login headers) through Oxylabs, to prove the next page of a listing call.
// Both take a hard timeout (the request is aborted), so a slow call cannot run past the caller's
// time budget. Neither logs in, sends cookies or handles credentials.
export async function oxylabsRaw(
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ httpStatus: number; body: any }> {
  const auth = Buffer
    .from(`${env('OXYLABS_USERNAME')}:${env('OXYLABS_PASSWORD')}`)
    .toString('base64');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, timeoutMs));
  try {
    const response = await fetch(OXYLABS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }
    return { httpStatus: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

export interface CapturedNetworkCallsResult {
  ok: boolean;
  /** Raw `content` of the Oxylabs result (normalised by the caller). */
  content: unknown;
  scrolled: boolean;
  /** Page actions of the attempt that returned: 'scroll+clicks', 'scroll' or 'none'. */
  actions: 'scroll+clicks' | 'scroll' | 'none' | 'type+submit';
  /** Earlier attempts that failed, with their error (newest last). */
  failed_attempts: Array<{ actions: string; error: string }>;
  status_code: number | null;
  ms: number;
  error?: string;
}

// Fix (step 5 per plan, 2026-10-07): after scrolling, the capture clicks a "more" button (View /
// Show / Load / See more, View all) and the next-page control (rel=next, a "Next" / "Next page"
// button or link, or a "next" control inside a pagination block), as the plan's network-call
// route says, so lazy lists and page 2 fire their background calls. Each click is skipped when the
// page has no such control; carousel "next slide" buttons are left alone. Generic text and ARIA
// patterns only, no site names.
const LC = "translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')";
const LC_ARIA = "translate(@aria-label,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')";
const LC_CLASS = "translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')";
const LC_PARENT_CLASS = "translate(../@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')";
const MORE_XPATH =
  `(//*[self::button or self::a][string-length(normalize-space(.)) < 40 and (` +
  ['show more', 'load more', 'view more', 'see more', 'view all', 'show all'].map((w) => `contains(${LC},'${w}')`).join(' or ') +
  `)])[1]`;
const NEXT_XPATH =
  `(//*[self::button or self::a][not(contains(${LC_ARIA},'slide')) and not(contains(${LC_CLASS},'carousel')) and (` +
  `@rel='next' or ${LC}='next' or ${LC}='next page' or ${LC}='›' or ${LC}='»' or contains(${LC_ARIA},'next page') or ${LC_ARIA}='next' or ` +
  `(ancestor::*[contains(${LC_CLASS},'pagination') or contains(${LC_ARIA},'pagination')] and (contains(${LC_ARIA},'next') or contains(${LC_CLASS},'next') or contains(${LC},'next') or contains(${LC_PARENT_CLASS},'next')))` +
  `)])[1]`;
const INSTRUCTIONS: Record<'scroll+clicks' | 'scroll', unknown[]> = {
  'scroll+clicks': [
    { type: 'scroll_to_bottom', timeout_s: 10 },
    { type: 'click', selector: { type: 'xpath', value: MORE_XPATH }, timeout_s: 5, on_error: 'skip' },
    { type: 'wait', wait_time_s: 2 },
    { type: 'click', selector: { type: 'xpath', value: NEXT_XPATH }, timeout_s: 5, on_error: 'skip' },
    { type: 'wait', wait_time_s: 3 },
  ],
  scroll: [{ type: 'scroll_to_bottom', timeout_s: 10 }, { type: 'wait', wait_time_s: 2 }],
};

export async function captureNetworkCalls(
  url: string,
  options: {
    timeoutMs: number;
    scroll?: boolean;
    geo_location?: string;
    user_agent_type?: string;
    /** Step 6 (search inputs): type a value into a search box, press its submit control, then scroll. */
    typeInput?: { xpath: string; value: string; submitXpath: string | null };
  },
): Promise<CapturedNetworkCallsResult> {
  validateUrl(url);
  const started = Date.now();
  const left = () => options.timeoutMs - (Date.now() - started);
  const base: Record<string, unknown> = { source: 'universal', url, render: 'html', xhr: true };
  const geo = options.geo_location ?? process.env['OXYLABS_GEO_LOCATION'];
  if (geo) base.geo_location = geo;
  const uat = options.user_agent_type ?? process.env['OXYLABS_USER_AGENT_TYPE'];
  if (uat) base.user_agent_type = uat;
  // Attempts, richest first; a failed attempt (rejected instructions, failed job) falls back to
  // the next one while enough time is left.
  const ladder: Array<'scroll+clicks' | 'scroll' | 'none' | 'type+submit'> = options.typeInput
    ? ['type+submit']
    : options.scroll === false ? ['none'] : ['scroll+clicks', 'scroll', 'none'];
  const failed: Array<{ actions: string; error: string }> = [];
  for (const actions of ladder) {
    if (failed.length && left() < 20_000) break;
    const instructions =
      actions === 'type+submit' && options.typeInput
        ? [
            { type: 'input', selector: { type: 'xpath', value: options.typeInput.xpath }, value: options.typeInput.value, timeout_s: 8 },
            // Fix (pick the suggestion, 2026-10-07): many search boxes only run the search when an
            // autocomplete suggestion is picked (or Enter pressed); the first role="option" is clicked
            // when one appears (wellsfargoadvisors.com: typing fired only the suggestion call).
            { type: 'wait', wait_time_s: 2 },
            { type: 'click', selector: { type: 'xpath', value: "(//*[@role='option'])[1]" }, timeout_s: 3, on_error: 'skip' },
            { type: 'wait', wait_time_s: 1 },
            ...(options.typeInput.submitXpath
              ? [{ type: 'click', selector: { type: 'xpath', value: options.typeInput.submitXpath }, timeout_s: 5, on_error: 'skip' }]
              : []),
            { type: 'wait', wait_time_s: 4 },
            { type: 'scroll_to_bottom', timeout_s: 8 },
            { type: 'wait', wait_time_s: 2 },
          ]
        : actions === 'none' || actions === 'type+submit' ? null : INSTRUCTIONS[actions];
    const payload = instructions ? { ...base, browser_instructions: instructions } : base;
    try {
      const res = await oxylabsRaw(payload, left());
      const result = res.body?.results?.[0];
      const status = typeof result?.status_code === 'number' ? result.status_code : null;
      if (res.httpStatus >= 400 || !result || (status != null && status >= 600)) {
        failed.push({ actions, error: `Oxylabs HTTP ${res.httpStatus}${status != null ? ` / result ${status}` : ''}: ${JSON.stringify(res.body).slice(0, 200)}` });
        continue;
      }
      return {
        ok: true,
        content: result.content ?? null,
        scrolled: actions !== 'none',
        actions,
        failed_attempts: failed,
        status_code: status,
        ms: Date.now() - started,
      };
    } catch (error) {
      failed.push({ actions, error: String(error).slice(0, 200) });
    }
  }
  return {
    ok: false,
    content: null,
    scrolled: false,
    actions: 'none',
    failed_attempts: failed,
    status_code: null,
    ms: Date.now() - started,
    error: failed.length ? failed[failed.length - 1].error : 'no attempt (time budget)',
  };
}

export interface ApiCallResult { ok: boolean; status_code: number | null; content: string | null; ms: number; error?: string }

export async function fetchApiCall(request: {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string | null;
  crawl_method: CrawlMethod;
  timeoutMs: number;
}): Promise<ApiCallResult> {
  validateUrl(request.url);
  const started = Date.now();
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    return { ok: false, status_code: null, content: null, ms: 0, error: `method ${method} not supported` };
  }
  const headers = request.headers ?? {};
  // Same rule as scrapeWebsite: a real no-proxy request only for 'direct' with FORCE_PROXY=false.
  if (request.crawl_method === 'direct' && !FORCE_PROXY) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1_000, request.timeoutMs));
    try {
      const r = await fetch(request.url, {
        method,
        headers,
        body: method === 'POST' ? request.body ?? '' : undefined,
        signal: controller.signal,
      });
      const text = await r.text();
      return { ok: r.ok, status_code: r.status, content: text, ms: Date.now() - started };
    } catch (error) {
      return { ok: false, status_code: null, content: null, ms: Date.now() - started, error: String(error).slice(0, 300) };
    } finally {
      clearTimeout(timer);
    }
  }
  const context: Array<{ key: string; value: unknown }> = [];
  if (method === 'POST') {
    context.push({ key: 'http_method', value: 'post' });
    context.push({ key: 'content', value: Buffer.from(request.body ?? '', 'utf8').toString('base64') });
  }
  if (Object.keys(headers).length) {
    context.push({ key: 'force_headers', value: true });
    context.push({ key: 'headers', value: headers });
  }
  const payload: Record<string, unknown> = { source: 'universal', url: request.url };
  if (context.length) payload.context = context;
  const geo = process.env['OXYLABS_GEO_LOCATION'];
  if (geo) payload.geo_location = geo;
  try {
    const res = await oxylabsRaw(payload, request.timeoutMs);
    const result = res.body?.results?.[0];
    if (res.httpStatus >= 400 || !result) {
      return { ok: false, status_code: null, content: null, ms: Date.now() - started, error: `Oxylabs HTTP ${res.httpStatus}: ${JSON.stringify(res.body).slice(0, 300)}` };
    }
    const status = typeof result.status_code === 'number' ? result.status_code : null;
    const content = typeof result.content === 'string' ? result.content : result.content == null ? null : JSON.stringify(result.content);
    return { ok: status != null && status < 400 && !!content, status_code: status, content, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, status_code: null, content: null, ms: Date.now() - started, error: String(error).slice(0, 300) };
  }
}

async function handle(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'POST required' }, { status: 405 });
  }

  if (request.headers.get('x-disco-worker-key') !== env('DISCO_WORKER_KEY')) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: ScrapeRequest;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body?.url || !body?.crawl_method) {
    return Response.json(
      { error: 'url and crawl_method are required' },
      { status: 400 },
    );
  }

  if (!VALID_CRAWL_METHODS.includes(body.crawl_method)) {
    return Response.json(
      { error: `crawl_method must be one of ${VALID_CRAWL_METHODS.join(', ')}` },
      { status: 400 },
    );
  }

  try {
    const result = await scrapeWebsite(body);
    return Response.json(result, { status: result.ok ? 200 : 502 });
  } catch (error) {
    return Response.json({ ok: false, error: String(error) }, { status: 400 });
  }
}

export const Route = createFileRoute('/api/public/disco-webscraper-worker')({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
    },
  },
});
