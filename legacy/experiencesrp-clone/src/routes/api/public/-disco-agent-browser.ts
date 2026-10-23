// ============================================================================
// disco agent browser — site mapper version 2 (AI agent), live remote browser (2026-10-09).
//
// Drives Oxylabs Headless Browser (a real Chrome on Oxylabs IPs) over the Chrome DevTools protocol
// from the worker: open a page, take a snapshot (numbered links and controls, visible text), click,
// type, scroll, go back, and record the page's documents and data calls (XHR / fetch, incl. request
// headers, post data and response bodies) so the AI can replay an API without the browser.
// Ported from the standalone AutoCrawl tool's Chrome class (main.py, section 6). Like the original,
// the Runtime domain is never enabled and no script is injected (page reads use the DOM domain).
//
// A later worker call starts a fresh browser and reopens the last page (network records carry over).
// Credentials: OXYLABS_HB_USERNAME / OXYLABS_HB_PASSWORD.
//
// The leading dash in the file name keeps it out of the file router.
// ============================================================================

export class BrowserError extends Error {}

const NOISE_URL = new RegExp(
  'google-analytics|googletagmanager|googlesyndication|googleadservices|doubleclick|adservice\\.google|'
  + 'google\\.[a-z.]+/(?:ads|pagead|ccm|gmp)|facebook\\.(?:com|net)|fbcdn|bat\\.bing|clarity\\.ms|hotjar|segment\\.(?:com|io)|'
  + 'amplitude|nr-data\\.net|newrelic|datadoghq|sentry|optimizely|mixpanel|heapanalytics|fullstory|tiktok|snapchat|'
  + 'pinterest|linkedin|ads-twitter|adnxs|criteo|taboola|outbrain|quantserve|scorecardresearch|demdex|everesttech|'
  + 'adobedtm|omtrdc|medallia|onetrust|cookielaw|cookiebot|recaptcha|gstatic|youtube|ytimg|spotify|nextdoor|adsrvr|'
  + 'rubiconproject|pubmatic|moatads|krxd|bluekai|rlcdn|tapad|cloudflareinsights|cdn-cgi/rum|cdn-cgi/challenge-platform|liveperson|intercom|'
  + 'zendesk|hubspot|hs-analytics|marketo|pardot|braze|branch\\.io|appsflyer|glassbox|schemaapp|cls_report|'
  + '/(?:collect|beacon|pixel|telemetry|tracking|clickstream|ingestion|metrics|analytics)\\b|/tl$', 'i');
const RELEVANT_TYPES = new Set(['Document', 'XHR', 'Fetch', 'Other', 'EventSource']);
const DATA_MIME = /json|xml|html|text|graphql|x-www-form-urlencoded|x-component/i;
const TEXT_MIME = /json|text|javascript|xml|html|css|x-www-form-urlencoded|graphql/i;
const FILE_URL = /\.(?:gz|zip|pdf|csv|xlsx?|docx?|tar|tgz|7z|rar|mp4|mp3)$/i;
const BOT_CHECK_TITLE = /just a moment|attention required|checking your browser|verify you are human|please wait|security check/i;
const BODY_CAP = 200_000;   // Fix (v2 memory, 2026-10-09): 400 KB -> 200 KB per recorded body; at most 300 records kept

export type NetRecord = {
  seq: number; url: string; method: string; type: string; status?: number; mime_type?: string;
  request_headers?: Record<string, string>; post_data?: string | null; response_headers?: Record<string, string>;
  body?: string | null; error?: string | null; duration_ms?: number; redirect_to?: string | null;
};
export type BrowserState = {
  session_name: string; target_id: string | null; seq: number; records: NetRecord[]; unread: number[];
  scripts: string[]; navigations: string[]; last_url: string | null;
};

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new BrowserError(`${label}: timed out after ${ms} ms`)), Math.max(1, ms));
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const b64decode = (s: string) => { try { return new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0))); } catch { return ''; } };

class Cdp {
  private id = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private handlers = new Map<string, Array<(params: any, sessionId?: string) => void>>();
  closed = false;
  constructor(private ws: WebSocket) {
    ws.addEventListener('message', (ev: MessageEvent) => {
      let msg: any;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer));
      } catch { return; }
      if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new BrowserError(`${msg.error.message ?? 'CDP error'} (${msg.error.code ?? ''})`));
        else p.resolve(msg.result ?? {});
      } else if (msg.method) {
        for (const h of this.handlers.get(msg.method) ?? []) {
          try { h(msg.params ?? {}, msg.sessionId); } catch { /* a handler never breaks the reader */ }
        }
      }
    });
    ws.addEventListener('close', () => {
      this.closed = true;
      for (const p of this.pending.values()) p.reject(new BrowserError('browser connection closed'));
      this.pending.clear();
    });
  }
  on(method: string, fn: (params: any, sessionId?: string) => void) {
    this.handlers.set(method, [...(this.handlers.get(method) ?? []), fn]);
  }
  send(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 30_000): Promise<any> {
    if (this.closed) return Promise.reject(new BrowserError('browser connection closed'));
    const id = ++this.id;
    const p = new Promise<any>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return withTimeout(p, timeoutMs, method);
  }
  close() { try { this.ws.close(); } catch { /* already closed */ } }
}

async function openWebSocket(host: string, query: string, user: string, pass: string): Promise<WebSocket> {
  const errors: string[] = [];
  try {
    const res: any = await withTimeout(fetch(`https://${host}/${query}`, {
      headers: { Upgrade: 'websocket', Authorization: `Basic ${btoa(`${user}:${pass}`)}` },
    }), 25_000, 'websocket upgrade');
    const ws: WebSocket | undefined = res?.webSocket;
    if (ws) { (ws as any).accept(); return ws; }
    errors.push(`fetch upgrade: HTTP ${res?.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  } catch (e) {
    errors.push(`fetch upgrade: ${String(e).slice(0, 200)}`);
  }
  try {
    const WS: any = (globalThis as any).WebSocket;
    const ws: WebSocket = new WS(`wss://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}/${query}`);
    await withTimeout(new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', (e: any) => reject(new BrowserError(`websocket error ${e?.message ?? ''}`)));
      ws.addEventListener('close', (e: any) => reject(new BrowserError(`websocket closed ${e?.code ?? ''} ${e?.reason ?? ''}`)));
    }), 25_000, 'websocket open');
    return ws;
  } catch (e) {
    errors.push(`constructor: ${String(e).slice(0, 200)}`);
  }
  throw new BrowserError(`could not connect to the remote browser: ${errors.join(' | ')}`);
}

export class RemoteBrowser {
  private cdp!: Cdp;
  private session!: string;
  targetId: string | null = null;
  records = new Map<number, NetRecord>();
  unread: number[] = [];
  scripts: string[] = [];
  navigations: string[] = [];
  lastUrl: string | null = null;
  restarted = false;
  private seq = 0;
  private exchanges = new Map<string, NetRecord>();
  private extraReq = new Map<string, Record<string, string>>();
  private extraRes = new Map<string, Record<string, string>>();
  private sessions = new Map<string, string>();
  private elements = new Map<number, number>();
  private lastActivity = Date.now();
  private pendingBodies = 0;

  constructor(public sessionName: string) {}

  static async connect(state: BrowserState | null, sessionName: string, country = 'US'): Promise<RemoteBrowser> {
    const user = process.env['OXYLABS_HB_USERNAME'];
    const pass = process.env['OXYLABS_HB_PASSWORD'];
    if (!user || !pass) throw new BrowserError('OXYLABS_HB_USERNAME / OXYLABS_HB_PASSWORD are not configured');
    const b = new RemoteBrowser(state?.session_name ?? sessionName);
    if (state) {
      b.seq = state.seq;
      for (const r of state.records) b.records.set(r.seq, r);
      b.unread = [...state.unread];
      b.scripts = [...state.scripts];
      b.navigations = [...state.navigations];
      b.lastUrl = state.last_url;
    }
    // Fix (v2 browser session, 2026-10-09): no Oxylabs session_name. With it, attaching to a tab failed
    // ("Session with given id not found", kw.com dry runs 3975-3976) and names over 36 characters were
    // refused (elliman.com 3977, wellsfargoadvisors.com 3978); the probe without it worked. A later worker
    // call starts a fresh browser and reopens the last page (the AI is told the browser was restarted).
    const ws = await openWebSocket('hb.oxylabs.io', `?p_cc=${encodeURIComponent(country)}`, user, pass);
    b.cdp = new Cdp(ws);
    b.wire();
    // Fix (v2 browser attach, 2026-10-09): our own tab is created (as in the probe) unless a saved tab
    // of this session still exists; attaching to a tab the service opened itself failed with
    // "Session with given id not found" (kw.com dry run 3975). One retry on a fresh tab.
    const targets: any[] = (await b.cdp.send('Target.getTargets')).targetInfos ?? [];
    const saved = state?.target_id ? targets.find((t) => t.type === 'page' && t.targetId === state.target_id) : null;
    if (!saved && state?.last_url) b.restarted = true;
    const attach = async (targetId: string) => {
      const { sessionId } = await b.cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await b.cdp.send('Network.enable', { maxPostDataSize: 1_000_000 }, sessionId);
      await b.cdp.send('Page.enable', {}, sessionId);
      await b.cdp.send('DOM.enable', {}, sessionId);
      b.targetId = targetId;
      b.session = sessionId;
      b.sessions.set(sessionId, 'page');
    };
    const fresh = async () => (await b.cdp.send('Target.createTarget', { url: 'about:blank' })).targetId as string;
    try {
      await attach(saved ? saved.targetId : await fresh());
    } catch (e) {
      try { await attach(await fresh()); b.restarted = !!state?.last_url; }
      catch (e2) { throw new BrowserError(`could not attach to a browser tab: ${String(e).slice(0, 120)} / ${String(e2).slice(0, 120)}`); }
    }
    const sessionId = b.session;
    await b.cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId).catch(() => null);
    if (b.restarted && state?.last_url) await b.open(state.last_url).catch(() => null);
    return b;
  }

  exportState(): BrowserState {
    const recs = [...this.records.values()].sort((a, b) => a.seq - b.seq).slice(-80)
      .map((r) => ({ ...r, body: r.body ? r.body.slice(0, 15_000) : r.body, post_data: r.post_data ? r.post_data.slice(0, 8_000) : r.post_data }));
    return { session_name: this.sessionName, target_id: this.targetId, seq: this.seq, records: recs, unread: this.unread.slice(-200),
      scripts: this.scripts.slice(0, 300), navigations: this.navigations.slice(-20), last_url: this.lastUrl };
  }
  close() { this.cdp?.close(); }
  get closed(): boolean { return !this.cdp || this.cdp.closed; }

  // ---- recorder ---------------------------------------------------------------------------
  private relevant(e: NetRecord): boolean {
    if (!RELEVANT_TYPES.has(e.type) || e.url.startsWith('data:') || NOISE_URL.test(e.url.split('?')[0])) return false;
    return e.type !== 'Other' || e.mime_type == null || DATA_MIME.test(e.mime_type);
  }
  private wire() {
    const c = this.cdp;
    c.on('Target.attachedToTarget', (p) => {
      const sid = p.sessionId;
      const type = p.targetInfo?.type;
      // Fix (v2 own tab detached, 2026-10-09): attaching to our own tab also fires this event; it was
      // detached here as "not a frame or worker", so every later command failed with "Session with
      // given id not found" (dry runs 3976-3981). Page targets are left alone.
      if (type === 'page' || p.targetInfo?.targetId === this.targetId) return;
      if (!['iframe', 'worker', 'service_worker', 'shared_worker'].includes(type)) {
        c.send('Target.detachFromTarget', { sessionId: sid }, undefined, 5_000).catch(() => null);
        return;
      }
      this.sessions.set(sid, type);
      c.send('Network.enable', { maxPostDataSize: 1_000_000 }, sid, 10_000).catch(() => null);
    });
    c.on('Target.targetInfoChanged', (p) => {
      const info = p.targetInfo;
      if (info?.targetId === this.targetId && /^https?:/.test(info.url) && this.navigations[this.navigations.length - 1] !== info.url) {
        this.navigations.push(info.url);
        this.lastUrl = info.url;
      }
    });
    c.on('Network.requestWillBeSent', (p, sid) => {
      const k = `${sid}:${p.requestId}`;
      const prev = this.exchanges.get(k);
      if (prev && p.redirectResponse) {
        this.applyResponse(prev, p.redirectResponse);
        this.complete(k, prev, null, p.request?.url);
      }
      const e: NetRecord = {
        seq: ++this.seq, url: p.request?.url ?? '', method: p.request?.method ?? 'GET', type: p.type ?? 'Other',
        request_headers: this.extraReq.get(k) ?? p.request?.headers ?? {}, post_data: p.request?.postData ?? null,
      };
      this.extraReq.delete(k);
      (e as any)._start = Date.now();
      this.exchanges.set(k, e);
      if (this.relevant(e)) {
        this.lastActivity = Date.now();
        if (p.request?.hasPostData && e.post_data == null) {
          c.send('Network.getRequestPostData', { requestId: p.requestId }, sid, 10_000).then((r) => { e.post_data = r?.postData ?? null; }, () => null);
        }
      }
    });
    c.on('Network.requestWillBeSentExtraInfo', (p, sid) => {
      const k = `${sid}:${p.requestId}`;
      const e = this.exchanges.get(k);
      if (e) e.request_headers = p.headers ?? {}; else this.extraReq.set(k, p.headers ?? {});
    });
    c.on('Network.responseReceived', (p, sid) => {
      const k = `${sid}:${p.requestId}`;
      const e = this.exchanges.get(k);
      if (!e) return;
      this.applyResponse(e, p.response ?? {});
      if (this.extraRes.has(k)) { e.response_headers = this.extraRes.get(k); this.extraRes.delete(k); }
    });
    c.on('Network.responseReceivedExtraInfo', (p, sid) => {
      const k = `${sid}:${p.requestId}`;
      const e = this.exchanges.get(k);
      if (e && e.status != null) e.response_headers = p.headers ?? {}; else this.extraRes.set(k, p.headers ?? {});
    });
    c.on('Network.loadingFinished', (p, sid) => {
      const k = `${sid}:${p.requestId}`;
      const e = this.exchanges.get(k);
      if (!e) return;
      this.exchanges.delete(k);
      if (e.type === 'Script' && !NOISE_URL.test(e.url.split('?')[0]) && !this.scripts.includes(e.url)) this.scripts.push(e.url);
      if (this.relevant(e) && !e.url.startsWith('data:') && TEXT_MIME.test(e.mime_type ?? '')) {
        this.pendingBodies++;
        c.send('Network.getResponseBody', { requestId: p.requestId }, sid, 15_000).then((r) => {
          const body = r?.base64Encoded ? b64decode(r.body ?? '') : (r?.body ?? '');
          this.complete(k, e, body.slice(0, BODY_CAP), null);
        }, () => this.complete(k, e, null, null)).finally(() => { this.pendingBodies--; });
      } else {
        this.complete(k, e, null, null);
      }
    });
    c.on('Network.loadingFailed', (p, sid) => {
      const k = `${sid}:${p.requestId}`;
      const e = this.exchanges.get(k);
      if (!e) return;
      this.exchanges.delete(k);
      e.error = [p.errorText, p.blockedReason, p.canceled ? 'canceled' : ''].filter(Boolean).join(' · ');
      this.complete(k, e, null, null);
    });
  }
  private applyResponse(e: NetRecord, r: any) {
    e.status = r.status;
    e.mime_type = r.mimeType;
    if (!e.response_headers) e.response_headers = r.headers ?? {};
  }
  private complete(_k: string, e: NetRecord, body: string | null, redirectTo: string | null) {
    e.body = body;
    e.redirect_to = redirectTo;
    e.duration_ms = Date.now() - ((e as any)._start ?? Date.now());
    delete (e as any)._start;
    if (!this.relevant(e)) return;
    this.lastActivity = Date.now();
    this.records.set(e.seq, e);
    this.unread.push(e.seq);
    if (this.records.size > 300) {
      const oldest = [...this.records.keys()].sort((x, y) => x - y).slice(0, this.records.size - 300);
      for (const k of oldest) this.records.delete(k);
    }
  }

  async waitIdle(quietMs = 1_200, timeoutMs = 15_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (Date.now() - this.lastActivity >= quietMs && Date.now() - start >= quietMs && this.pendingBodies === 0) return;
      await sleep(200);
    }
  }

  // ---- page control -------------------------------------------------------------------------
  async info(): Promise<{ url: string; title: string }> {
    const t = (await this.cdp.send('Target.getTargetInfo', { targetId: this.targetId })).targetInfo ?? {};
    return { url: t.url ?? '', title: t.title ?? '' };
  }
  /** A bot-check interstitial clears itself in the remote browser after a few seconds. */
  private async waitBotCheck(maxMs = 20_000): Promise<void> {
    const end = Date.now() + maxMs;
    while (Date.now() < end) {
      const { title } = await this.info();
      if (!BOT_CHECK_TITLE.test(title)) return;
      await sleep(1_000);
    }
  }
  async open(url: string): Promise<void> {
    let path = '';
    try { path = new URL(url).pathname; } catch { throw new BrowserError(`not a URL: ${url}`); }
    if (FILE_URL.test(path)) throw new BrowserError('that URL is a file download, not a page; use sitemap_probe or http_fetch for it');
    const r = await this.cdp.send('Page.navigate', { url }, this.session, 45_000);
    if (r?.errorText) throw new BrowserError(`navigation failed: ${r.errorText}`);
    this.lastUrl = url;
    await sleep(500);
    await this.waitIdle(1_500, 20_000);
    await this.waitBotCheck();
    await this.waitIdle(1_200, 10_000);
  }
  async snapshot(maxElements = 70, maxText = 1_200): Promise<string> {
    const page = await this.info();
    const root = (await this.cdp.send('DOM.getDocument', { depth: -1, pierce: true }, this.session, 30_000)).root;
    let host = '';
    try { host = new URL(page.url).hostname.replace(/^www\./, ''); } catch { /* about:blank */ }
    const texts: string[] = [];
    const controls: Array<[number, string]> = [];
    const links: Array<[number, string, boolean]> = [];
    let nodes = 0;
    const walk = (node: any): string => {
      if (++nodes > 60_000) return '';
      const name = node.nodeName ?? '';
      if (node.nodeType === 3) {
        const v = String(node.nodeValue ?? '').trim();
        if (v && texts.length < 4_000) texts.push(v);
        return v;
      }
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'HEAD', 'TEMPLATE', 'IFRAME'].includes(name)) return '';
      const own: string[] = [];
      for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) { const t = walk(child); if (t) own.push(t); }
      if (node.contentDocument) walk(node.contentDocument);
      const raw: string[] = node.attributes ?? [];
      const a: Record<string, string> = {};
      for (let i = 0; i + 1 < raw.length; i += 2) a[raw[i]] = raw[i + 1];
      const label = (a['aria-label'] || own.join(' ').slice(0, 70) || a.placeholder || a.title || a.value || a.name || a.alt || '').trim().slice(0, 70);
      const backend = node.backendNodeId;
      if (name === 'A' && a.href && !/^(javascript:|mailto:|tel:|#)/i.test(a.href)) {
        let href = a.href;
        try { href = new URL(a.href, page.url).toString(); } catch { /* keep */ }
        let same = false;
        try { same = new URL(href).hostname.endsWith(host); } catch { /* no */ }
        links.push([backend, `link ${JSON.stringify(label)} -> ${href}`, same]);
      } else if (['BUTTON', 'SELECT', 'TEXTAREA'].includes(name) || (name === 'INPUT' && (a.type ?? 'text') !== 'hidden')
        || ['button', 'link', 'tab', 'option', 'menuitem', 'combobox', 'searchbox', 'checkbox', 'radio'].includes(a.role ?? '')) {
        const kind = name === 'INPUT' ? `input[${a.type ?? 'text'}]` : name.toLowerCase();
        controls.push([backend, `${kind} ${JSON.stringify(label)}${a.name ? ` name=${a.name}` : ''}`]);
      }
      return own.join(' ').slice(0, 80);
    };
    walk(root);
    const seen = new Set<string>();
    const ordered: Array<[number, string]> = [];
    for (const [backend, desc] of links.sort((x, y) => Number(y[2]) - Number(x[2]))) {
      if (!seen.has(desc)) { seen.add(desc); ordered.push([backend, desc]); }
    }
    const chosen = [...controls.slice(0, 40), ...ordered.slice(0, Math.max(0, maxElements - Math.min(controls.length, 40)))];
    this.elements = new Map(chosen.map(([backend], i) => [i + 1, backend]));
    const body = texts.join(' | ');
    return [
      `URL: ${page.url}`, `TITLE: ${page.title}`,
      `ELEMENTS (${controls.length} controls, ${links.length} links; showing ${chosen.length}):`,
      ...chosen.map(([, desc], i) => `[${i + 1}] ${desc}`),
      `TEXT: ${body.slice(0, maxText)}${body.length > maxText ? '…' : ''}`,
    ].join('\n');
  }
  private async center(element: number): Promise<[number, number]> {
    const backend = this.elements.get(element);
    if (backend == null) throw new BrowserError(`element [${element}] is not in the last snapshot; take a new snapshot`);
    try {
      await this.cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: backend }, this.session);
      const quad: number[] = (await this.cdp.send('DOM.getBoxModel', { backendNodeId: backend }, this.session)).model.content;
      return [(quad[0] + quad[2] + quad[4] + quad[6]) / 4, (quad[1] + quad[3] + quad[5] + quad[7]) / 4];
    } catch (e) {
      throw new BrowserError(`element [${element}] is not visible or clickable (${String(e).slice(0, 80)}); open its URL instead`);
    }
  }
  async click(element: number): Promise<void> {
    const before = new Set(((await this.cdp.send('Target.getTargets')).targetInfos ?? []).map((t: any) => t.targetId));
    const [x, y] = await this.center(element);
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, this.session);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, this.session);
    }
    await sleep(800);
    const popups = ((await this.cdp.send('Target.getTargets')).targetInfos ?? [])
      .filter((t: any) => t.type === 'page' && !before.has(t.targetId) && /^http/.test(t.url));
    if (popups.length) {
      await this.cdp.send('Target.closeTarget', { targetId: popups[0].targetId }).catch(() => null);
      await this.open(popups[0].url);
    } else {
      await this.waitIdle();
      await this.waitBotCheck(10_000);
    }
  }
  async type(element: number, text: string, submit = false): Promise<void> {
    const [x, y] = await this.center(element);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, this.session);
    }
    await this.cdp.send('Input.insertText', { text }, this.session);
    await sleep(600);
    if (submit) {
      await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' }, this.session);
      await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }, this.session);
    }
    await this.waitIdle();
  }
  async scroll(direction: 'down' | 'up' = 'down'): Promise<void> {
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 400, y: 400, deltaX: 0, deltaY: direction === 'down' ? 1800 : -1800 }, this.session);
    await this.waitIdle(1_000);
  }
  async back(): Promise<void> {
    const h = await this.cdp.send('Page.getNavigationHistory', {}, this.session);
    if (!h.currentIndex) throw new BrowserError('no previous page');
    await this.cdp.send('Page.navigateToHistoryEntry', { entryId: h.entries[h.currentIndex - 1].id }, this.session);
    await this.waitIdle();
  }
}
