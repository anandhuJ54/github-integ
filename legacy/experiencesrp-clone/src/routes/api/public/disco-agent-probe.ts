// ============================================================================
// disco agent probe — site mapper version 2 (AI agent), feasibility check (2026-10-09).
//
// Read-only checks for the agent-based site mapper (version 2, built next to the current mapper,
// not replacing it). Nothing is written anywhere; no database access.
//   - model:  one tiny call to the Anthropic API with the requested model (default claude-sonnet-5-5),
//             to confirm our key can use it.
//   - hb:     Oxylabs Headless Browser (remote Chrome on Oxylabs IPs, driven over the Chrome DevTools
//             protocol): connect from this worker, open a page, read title / links / background calls,
//             scroll once, and time each step.
//   - render: the same page through the Oxylabs render + background-call capture used today
//             (captureNetworkCalls), for a speed comparison.
//
// POST /api/public/disco-agent-probe   header x-disco-worker-key
// body: { checks?: ('model'|'hb'|'render')[], url?: string, model?: string, country?: string }
// Credentials: OXYLABS_HB_USERNAME / OXYLABS_HB_PASSWORD when set, else OXYLABS_USERNAME / OXYLABS_PASSWORD.
// ============================================================================
import { createFileRoute } from '@tanstack/react-router';
import { captureNetworkCalls } from './disco-webscraper-worker';

type Step = { step: string; ms: number; ok: boolean; detail?: unknown };

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}: timed out after ${ms} ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

// ---- model check ------------------------------------------------------------------------
async function checkModel(model: string): Promise<Record<string, unknown>> {
  const started = Date.now();
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) return { ok: false, error: 'ANTHROPIC_API_KEY not configured' };
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with the word OK.' }] }),
    });
    const text = await res.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    return {
      ok: res.ok,
      status: res.status,
      model_requested: model,
      model_answered: body?.model ?? null,
      reply: Array.isArray(body?.content) ? body.content.map((b: any) => b?.text ?? '').join('').slice(0, 40) : null,
      usage: body?.usage ?? null,
      ...(res.ok ? {} : { error: text.slice(0, 400) }),
      ms: Date.now() - started,
    };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 300), ms: Date.now() - started };
  }
}

// ---- minimal Chrome DevTools protocol client over a WebSocket ---------------------------
class Cdp {
  private id = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  events: Array<{ method: string; params: any; sessionId?: string }> = [];
  constructor(private ws: WebSocket) {
    ws.addEventListener('message', (ev: MessageEvent) => {
      let msg: any;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer));
      } catch { return; }
      if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${msg.error.message ?? 'CDP error'} (${msg.error.code ?? ''})`));
        else p.resolve(msg.result ?? {});
      } else if (msg.method) {
        if (this.events.length < 5000) this.events.push({ method: msg.method, params: msg.params, sessionId: msg.sessionId });
      }
    });
    ws.addEventListener('close', () => {
      for (const p of this.pending.values()) p.reject(new Error('websocket closed'));
      this.pending.clear();
    });
  }
  send(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 30_000): Promise<any> {
    const id = ++this.id;
    const p = new Promise<any>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return withTimeout(p, timeoutMs, method);
  }
  async waitFor(method: string, sessionId: string | undefined, timeoutMs: number, from = 0): Promise<boolean> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (this.events.slice(from).some((e) => e.method === method && (!sessionId || e.sessionId === sessionId))) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  }
}

/** Opens a client WebSocket: Cloudflare-style fetch upgrade first, then the WebSocket constructor. */
async function openWebSocket(host: string, query: string, user: string, pass: string): Promise<{ ws: WebSocket; via: string }> {
  const errors: string[] = [];
  try {
    const res: any = await withTimeout(fetch(`https://${host}/${query}`, {
      headers: { Upgrade: 'websocket', Authorization: `Basic ${btoa(`${user}:${pass}`)}` },
    }), 20_000, 'websocket upgrade');
    const ws: WebSocket | undefined = res?.webSocket;
    if (ws) { (ws as any).accept(); return { ws, via: 'fetch upgrade' }; }
    errors.push(`fetch upgrade: HTTP ${res?.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  } catch (e) {
    errors.push(`fetch upgrade: ${String(e).slice(0, 200)}`);
  }
  try {
    const WS: any = (globalThis as any).WebSocket;
    if (!WS) throw new Error('no WebSocket constructor');
    const ws: WebSocket = new WS(`wss://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}/${query}`);
    await withTimeout(new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', (e: any) => reject(new Error(`websocket error ${e?.message ?? ''}`)));
      ws.addEventListener('close', (e: any) => reject(new Error(`websocket closed ${e?.code ?? ''} ${e?.reason ?? ''}`)));
    }), 20_000, 'websocket open');
    return { ws, via: 'WebSocket constructor' };
  } catch (e) {
    errors.push(`constructor: ${String(e).slice(0, 200)}`);
  }
  throw new Error(errors.join(' | '));
}

async function checkHeadlessBrowser(url: string, country: string): Promise<Record<string, unknown>> {
  const steps: Step[] = [];
  const started = Date.now();
  const hbUser = process.env['OXYLABS_HB_USERNAME'];
  const user = hbUser ?? process.env['OXYLABS_USERNAME'] ?? '';
  const pass = process.env['OXYLABS_HB_PASSWORD'] ?? process.env['OXYLABS_PASSWORD'] ?? '';
  const credentials = hbUser ? 'OXYLABS_HB_*' : 'OXYLABS_* (scraper account)';
  if (!user || !pass) return { ok: false, credentials, error: 'no Oxylabs credentials configured' };
  const step = async <T>(name: string, fn: () => Promise<T>, detail?: (v: T) => unknown): Promise<T> => {
    const t = Date.now();
    try {
      const v = await fn();
      steps.push({ step: name, ms: Date.now() - t, ok: true, ...(detail ? { detail: detail(v) } : {}) });
      return v;
    } catch (e) {
      steps.push({ step: name, ms: Date.now() - t, ok: false, detail: String(e).slice(0, 300) });
      throw e;
    }
  };
  let ws: WebSocket | null = null;
  try {
    const opened = await step('connect', () => openWebSocket('hb.oxylabs.io', `?p_cc=${encodeURIComponent(country)}`, user, pass), (v) => v.via);
    ws = opened.ws;
    const cdp = new Cdp(ws);
    const version = await step('Browser.getVersion', () => cdp.send('Browser.getVersion'), (v) => v?.product);
    void version;
    const { targetId } = await step('Target.createTarget', () => cdp.send('Target.createTarget', { url: 'about:blank' }));
    const { sessionId } = await step('Target.attachToTarget', () => cdp.send('Target.attachToTarget', { targetId, flatten: true }));
    await step('enable', async () => {
      await cdp.send('Page.enable', {}, sessionId);
      await cdp.send('Network.enable', {}, sessionId);
      await cdp.send('Runtime.enable', {}, sessionId);
    });
    const mark = cdp.events.length;
    await step('Page.navigate', () => cdp.send('Page.navigate', { url }, sessionId, 60_000));
    await step('load event', async () => {
      if (!(await cdp.waitFor('Page.loadEventFired', sessionId, 60_000, mark))) throw new Error('no load event in 60 s');
    });
    const read = async () => (await cdp.send('Runtime.evaluate', {
      expression: `JSON.stringify({ url: location.href, title: document.title, links: document.querySelectorAll('a[href]').length, text: (document.body?.innerText || '').length, inputs: document.querySelectorAll('input').length })`,
      returnByValue: true,
    }, sessionId)).result?.value;
    // A bot-check interstitial (e.g. "Just a moment...") clears itself in the remote browser after a
    // few seconds; wait up to 25 s for the real page before reading it.
    await step('bot check cleared', async () => {
      const end = Date.now() + 25_000;
      for (;;) {
        const v = await read();
        const title = v ? String(JSON.parse(v).title ?? '') : '';
        if (!/just a moment|attention required|checking your browser|verify you are human|access denied/i.test(title)) return title;
        if (Date.now() > end) throw new Error(`still on "${title}" after 25 s`);
        await new Promise((r) => setTimeout(r, 1_000));
      }
    }, (t) => t).catch(() => null);
    const page1 = await step('read page', read, (v) => (v ? JSON.parse(v) : null));
    const dataCalls = () => cdp.events.filter((e) => e.method === 'Network.responseReceived' && e.sessionId === sessionId && ['XHR', 'Fetch'].includes(e.params?.type))
      .map((e) => `${e.params?.response?.status} ${String(e.params?.response?.url ?? '').slice(0, 140)}`);
    const callsAfterLoad = dataCalls().length;
    const scrollMark = cdp.events.length;
    await step('scroll to bottom', async () => {
      await cdp.send('Runtime.evaluate', { expression: 'window.scrollTo(0, document.body.scrollHeight)' }, sessionId);
      await new Promise((r) => setTimeout(r, 2_000));
    });
    const page2 = await step('read page after scroll', read, (v) => (v ? JSON.parse(v) : null));
    const callsAfterScroll = cdp.events.slice(scrollMark).filter((e) => e.method === 'Network.responseReceived' && ['XHR', 'Fetch'].includes(e.params?.type)).length;
    await cdp.send('Target.closeTarget', { targetId }).catch(() => null);
    return {
      ok: true,
      credentials,
      via: opened.via,
      page: page1 ? JSON.parse(page1) : null,
      page_after_scroll: page2 ? JSON.parse(page2) : null,
      data_calls_after_load: callsAfterLoad,
      data_calls_after_scroll: callsAfterScroll,
      data_call_sample: dataCalls().slice(0, 12),
      steps,
      ms: Date.now() - started,
    };
  } catch (e) {
    return { ok: false, credentials, error: String(e).slice(0, 400), steps, ms: Date.now() - started };
  } finally {
    try { ws?.close(); } catch { /* already closed */ }
  }
}

async function checkRender(url: string): Promise<Record<string, unknown>> {
  const started = Date.now();
  try {
    const r = await captureNetworkCalls(url, { timeoutMs: 120_000, scroll: true });
    return { ok: r.ok, status_code: r.status_code, scrolled: r.scrolled, error: r.error ?? null, calls: Array.isArray(r.content) ? r.content.length : null, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 300), ms: Date.now() - started };
  }
}

async function handle(request: Request): Promise<Response> {
  const workerKey = process.env['DISCO_WORKER_KEY'];
  if (!workerKey || request.headers.get('x-disco-worker-key') !== workerKey) return new Response('Unauthorized', { status: 401 });
  let body: any = {};
  try { body = await request.json(); } catch { /* defaults */ }
  const checks: string[] = Array.isArray(body.checks) && body.checks.length ? body.checks : ['model', 'hb', 'render'];
  const url = typeof body.url === 'string' && /^https?:\/\//.test(body.url) ? body.url : 'https://kw.com/agents';
  const model = typeof body.model === 'string' && body.model ? body.model : 'claude-sonnet-5-5';
  const country = typeof body.country === 'string' && body.country ? body.country : 'US';
  const started = Date.now();
  const [m, hb, render] = await Promise.all([
    checks.includes('model') ? checkModel(model) : Promise.resolve(null),
    checks.includes('hb') ? checkHeadlessBrowser(url, country) : Promise.resolve(null),
    checks.includes('render') ? checkRender(url) : Promise.resolve(null),
  ]);
  // Which credential names this build can see (names only, never values).
  const env_seen = Object.fromEntries(
    ['OXYLABS_HB_USERNAME', 'OXYLABS_HB_PASSWORD', 'OXYLABS_USERNAME', 'OXYLABS_PASSWORD', 'ANTHROPIC_API_KEY'].map((k) => [k, !!process.env[k]]),
  );
  return Response.json({ probe: 'disco-agent', url, ms: Date.now() - started, env_seen, model: m, headless_browser: hb, render });
}

export const Route = createFileRoute('/api/public/disco-agent-probe')({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
    },
  },
});
