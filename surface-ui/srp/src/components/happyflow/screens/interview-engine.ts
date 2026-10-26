/**
 * Interview v2 — demo data and the beat machine (typewriter, animations, gates, score tween,
 * "+N" chips flying into the ring). Ported from the Claude Design prototype's logic class.
 * Every timer, interval, animation frame and flying chip is tracked and released in `destroy()`.
 */
import { createRef } from "react";
import { prefersReducedMotion } from "../primitives";

// Demo data (Happyflow prototype)
export const C = { b: "#4285f4", p: "#9b72f2", a: "#fbbc04", g: "#34a853", r: "#ea4335" };
export const SRC6: [string, number, string][] = [
  ["Your website", 5, C.b],
  ["Google Business Profile", 4, C.r],
  ["NMLS Consumer Access", 2, C.a],
  ["Zillow", 4, C.g],
  ["LinkedIn", 5, C.b],
  ["Facebook", 3, C.b],
];
const CUM = SRC6.reduce<number[]>((a, _x, i) => {
  a.push(i ? a[i - 1] + SRC6[i - 1][1] : 0);
  return a;
}, []);
export const SOURCES: [string, string][] = [
  ["demomortgage.com/alex-sample", "Your Demo Mortgage page"],
  ["Alex Sample – Demo Mortgage", "Google Business Profile"],
  ["NMLS #482913", "NMLS Consumer Access"],
  ["Lender profile", "Zillow"],
  ["Alex Sample", "LinkedIn"],
  ["Alex Sample, Mortgage", "Facebook"],
  ['"FHA loans explained in 4 minutes"', "YouTube"],
  ["Quad Cities Home Hour, episode 31", "Podcast"],
  ["Lender page", "Realtor.com"],
];
export const CLUSTERS: [string, number, string][] = [
  ["Identity", 12, C.b],
  ["Contact", 9, C.r],
  ["Licence", 6, C.a],
  ["Products", 11, C.p],
  ["Reviews", 15, C.g],
  ["Presence", 14, C.b],
];
export const PGROUPS: [string, string[]][] = [
  [
    "Purchase",
    [
      "Conventional",
      "FHA",
      "VA",
      "USDA / Rural",
      "Jumbo",
      "Down payment assistance",
      "First-time buyer programs",
    ],
  ],
  [
    "Refinance",
    ["Rate-and-term", "Cash-out", "FHA Streamline", "VA IRRRL", "HELOC", "Home equity loan"],
  ],
  [
    "Specialty",
    [
      "Non-QM / Bank statement",
      "DSCR / Investor",
      "Reverse mortgage",
      "Construction-to-perm",
      "Renovation (FHA 203k)",
      "Bridge",
      "Interest-only",
      "Manufactured home",
    ],
  ],
  ["How you start", ["Pre-approval", "Pre-qualification"]],
];
export const ALLP = PGROUPS.flatMap((g) => g[1]);
export const FOUND = new Set([
  "Conventional",
  "FHA",
  "VA",
  "USDA / Rural",
  "Jumbo",
  "Rate-and-term",
  "Cash-out",
  "HELOC",
  "Pre-approval",
]);
export const SCORE = [298, 298, 352, 352, 371, 371, 371, 384, 384, 384];
export const DONE: [string, string][] = [
  ["Found you in 6 places · 23 facts", ""],
  ["Confirmed your sources", ""],
  ["Built your profile · 67 facts", "+54"],
  ["Licence and contact settled", ""],
  ["Fixed 4 places", "+19"],
  ["Walled off the Tampa agent", ""],
  ["# products kept", "+13"],
  ["Mapped 5 competitors · 49 spots", ""],
  ["Check-ins: weekday mornings by text", ""],
];
export const PH: [string, number[], string][] = [
  ["Find", [0, 1, 2], "+54"],
  ["Fix", [3, 4, 5, 6], "+32"],
  ["Win", [7], ""],
  ["Agree", [8], ""],
];
export const CTA = [
  "Start",
  "These are me",
  "Continue",
  "Confirm",
  "Continue",
  "Continue",
  "Looks right",
  "Continue",
  "Works for me",
];
const FLY: (string | null)[] = [null, "+54", null, "+19", null, null, "+13", null, "✓ Agreed"];
/** Fact-dot colours around the interview ring (same order as the prototype). */
export const IV_DOTC = [
  C.b,
  C.r,
  C.a,
  C.g,
  C.b,
  C.b,
  C.b,
  C.r,
  C.a,
  C.p,
  C.g,
  C.b,
  C.a,
  C.r,
  C.r,
  C.r,
  C.r,
  C.r,
  C.p,
  C.p,
  C.p,
  C.r,
  C.r,
  C.r,
  C.r,
  C.r,
];

export type LineKey =
  | "hello1"
  | "hello2"
  | "src"
  | "aha1"
  | "lic"
  | "phone"
  | "mob"
  | "aha2"
  | "twin1"
  | "twin2"
  | "offer1"
  | "offer2"
  | "map1"
  | "map2"
  | "map3"
  | "map4"
  | "work"
  | "fin1"
  | "fin2";
export type Widget =
  | "chips"
  | "cta"
  | "sources"
  | "srcReact"
  | "clusters"
  | "nmls"
  | "phone"
  | "mob"
  | "fixes"
  | "fixDone"
  | "twin"
  | "products"
  | "offerReact"
  | "grid"
  | "compare"
  | "rank"
  | "moves"
  | "work"
  | "finale"
  | "task"
  | "finCta";
type AnimKey = "scan" | "clusters" | "fixes" | "grid" | "moves";
type Gate = "nmls" | "phone" | "mob" | "twin";
export type Beat = { l?: LineKey; w?: Widget; anim?: AnimKey; gate?: Gate };

export const B: Beat[][] = [
  [{ l: "hello1" }, { w: "chips", anim: "scan" }, { l: "hello2" }, { w: "cta" }],
  [{ l: "src" }, { w: "sources" }, { w: "srcReact" }, { w: "cta" }],
  [{ l: "aha1" }, { w: "clusters", anim: "clusters" }, { w: "cta" }],
  [
    { l: "lic" },
    { w: "nmls", gate: "nmls" },
    { l: "phone" },
    { w: "phone", gate: "phone" },
    { l: "mob" },
    { w: "mob", gate: "mob" },
    { w: "cta" },
  ],
  [{ l: "aha2" }, { w: "fixes", anim: "fixes" }, { w: "fixDone" }, { w: "cta" }],
  [{ l: "twin1" }, { w: "twin", gate: "twin" }, { l: "twin2" }, { w: "cta" }],
  [{ l: "offer1" }, { w: "products" }, { w: "offerReact" }, { l: "offer2" }, { w: "cta" }],
  [
    { l: "map1" },
    { w: "grid", anim: "grid" },
    { l: "map2" },
    { w: "compare" },
    { w: "rank" },
    { l: "map3" },
    { l: "map4" },
    { w: "moves", anim: "moves" },
    { w: "cta" },
  ],
  [{ l: "work" }, { w: "work" }, { w: "cta" }],
  [{ w: "finale" }, { l: "fin1" }, { l: "fin2" }, { w: "task" }, { w: "finCta" }],
];

/** Riverbend's 7 × 7 grid (the interview's own; Alex's grid is `GRID` from demo-data). */
export const RIVER: { bg: string }[] = (() => {
  const cells: { i: number; d: number; bg: string }[] = [];
  for (let r = 0; r < 7; r++)
    for (let c = 0; c < 7; c++)
      cells.push({
        i: r * 7 + c,
        d: Math.hypot(r - 2.4, c - 3.8) + ((r * 7 + c) % 5) * 0.07,
        bg: "",
      });
  [...cells]
    .sort((a, b) => a.d - b.d)
    .forEach((x, k) => {
      x.bg = k < 34 ? "#34a853" : k < 44 ? "#fbbc04" : "#fa7b17";
    });
  return cells.map((x) => ({ bg: x.bg }));
})();

export type Seg = { t: string; k: "b" | "n" | "pl" | "p" };
/** NORA's line markup: `**bold**`, `[[number chip]]`, `~place~`. */
export const parse = (s: string): Seg[] =>
  s
    .split(/(\*\*[^*]+\*\*|\[\[[^\]]+\]\]|~[^~]+~)/)
    .filter(Boolean)
    .map((t) =>
      t.startsWith("**")
        ? { t: t.slice(2, -2), k: "b" }
        : t.startsWith("[[")
          ? { t: t.slice(2, -2), k: "n" }
          : t.startsWith("~")
            ? { t: t.slice(1, -1), k: "pl" }
            : { t, k: "p" },
    );
export const segLen = (s: string) => parse(s).reduce((a, x) => a + x.t.length, 0);
const listJoin = (a: string[]) =>
  a.length < 2 ? a[0] || "" : a.slice(0, -1).join(", ") + " or " + a[a.length - 1];

export type IvState = {
  step: number;
  pos: number;
  typed: number;
  leaving: boolean;
  display: number;
  counter: number;
  reveal: number;
  ticks: number;
  ring: number;
  moves: number;
  checks: boolean[];
  nmls: boolean;
  mob: boolean;
  phone: string | null;
  addr: string | null;
  twin: "out" | null;
  products: Record<string, boolean>;
  toastMsg: string | null;
};

export const IV_INIT: IvState = {
  step: 0,
  pos: -1,
  typed: 0,
  leaving: false,
  display: 298,
  counter: 0,
  reveal: 0,
  ticks: 0,
  ring: -1,
  moves: 0,
  checks: SOURCES.map(() => true),
  nmls: false,
  mob: false,
  phone: null,
  addr: null,
  twin: null,
  products: Object.fromEntries(ALLP.map((n) => [n, FOUND.has(n)])),
  toastMsg: null,
};

export const kept = (st: IvState) => ALLP.filter((n) => st.products[n]);

export function lineText(st: IvState, k: LineKey, greet: string): string {
  const ph = st.phone || "(563) 555-0100";
  const ad = (st.addr || "100 Main St").split(",")[0];
  const n = kept(st).length;
  const L: Record<LineKey, string> = {
    hello1: `${greet}, Alex. Before you typed a thing, I found you in [[6 places]] — your **Demo Mortgage page**, Google, NMLS, Zillow, LinkedIn and Facebook.`,
    hello2: `That's [[23 facts]] about you, and you don't have to type any of them. Give me about 2 minutes: we'll check them together, I'll fix anything that's off, and I'll show you who's winning ~Davenport~ buyers so we can win them back.`,
    src: `Here's everything I think is yours, including your **FHA explainer** on YouTube and your **Quad Cities Home Hour** episode. Untick anything that isn't you.`,
    aha1: `[[6 sources, 67 facts]], one record. You've built **12 years** of expertise across the internet; now it lives in one place Google and AI can read.`,
    lic: `Two things only you can settle. **NMLS 482913**, licensed in ~Iowa~ and ~Illinois~ — right?`,
    phone: `Google and your website say [[(563) 555-0100]], but Zillow still shows [[(563) 555-0177]]. Which one should buyers call?`,
    mob: `And your mobile — that's where I'll text you when something needs you.`,
    aha2: `Done. [[${ph}]] and **${ad}** are now your only number and address. I corrected **Zillow**, **Yelp** and 2 directories that still had the old branch line.`,
    twin1: `There's another **Alex Sample** — a real estate agent in ~Tampa~. Different licence, different state. I'll keep her out of your record.`,
    twin2: `Walled off. If she shows up anywhere near your name, I'll catch it.`,
    offer1: `Here's what I read on your site. Your **FHA video** tells me first-time buyers are a big part of your work. Tick anything else you do.`,
    offer2: `[[${n} products]]. I'll make sure each one shows up when someone in ~Davenport~ searches for it.`,
    map1: `This is where ~Davenport~ buyers find a lender.`,
    map2: `**Riverbend Bank & Trust** shows up above you in [[34 of 49]] spots — you're top 3 in just [[9]].`,
    map3: `They have [[412 reviews]] to your [[128]], but yours average **4.9**. They have [[14 articles]]; you have none. That gap I can close.`,
    map4: `Here's my plan to get you past them: [[3 moves]], I'll do 2 myself.`,
    work: `You've got closings to run, so I'll do the work and only check in when something needs you. **Weekday mornings** by text — does that work?`,
    fin1: `Not bad for two minutes, Alex. Your record went from [[298]] to [[384]] and **Riverbend** now has a target on its back.`,
    fin2: `I've already started: adding your Google category and services. I'll text you **Tuesday morning** with what I've done.`,
  };
  return L[k];
}

/** NORA's reaction line to the sources / products the user changed ("" = nothing to say). */
export function reactText(st: IvState, w: Widget): string {
  if (w === "srcReact") {
    const off = SOURCES.filter((_s, i) => !st.checks[i]).map((s) => s[1]);
    return off.length
      ? `Noted — I'll leave **${off[0]}**${off.length > 1 ? ` and ${off.length - 1} more` : ""} out of your record.`
      : "";
  }
  const removed = ALLP.filter((n) => FOUND.has(n) && !st.products[n]);
  const added = ALLP.filter((n) => !FOUND.has(n) && st.products[n]);
  const out: string[] = [];
  if (removed.length)
    out.push(`Got it — no ${listJoin(removed)}. I'll keep your pages focused on what you close.`);
  if (added.length)
    out.push(
      `Added **${listJoin(added).replace(" or ", " and ")}** — I'll build a page for ${added.length > 1 ? "each" : "it"} too.`,
    );
  return out.join(" ");
}

export const popped = (st: IvState) => CUM.filter((c) => c < st.counter).length;

export function dotCount(st: IvState) {
  const c = st.step;
  let n = c === 0 ? popped(st) : 6;
  if (c >= 2) n += c === 2 ? st.reveal : 6;
  if (st.nmls) n++;
  if (c >= 4) n++;
  if (c >= 4) n += c === 4 ? st.ticks : 4;
  if (c >= 7) n += 3;
  if ((c === 7 && st.ring >= 3) || c > 7) n += 5;
  return Math.min(n, IV_DOTC.length);
}

type NumKey = "counter" | "reveal" | "ticks" | "ring" | "moves";

export class InterviewEngine {
  st: IvState = IV_INIT;
  bodyRef = createRef<HTMLDivElement>();
  rootRef = createRef<HTMLDivElement>();
  greet = "Morning";
  private push: (s: IvState) => void;
  private alive = false;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private intervals: ReturnType<typeof setInterval>[] = [];
  private raf = 0;
  private scrollRaf = 0;
  private toastT: ReturnType<typeof setTimeout> | undefined;
  private chips = new Set<HTMLElement>();
  private tg = 298;
  private skipFlag = false;
  private quick = false;
  private askT = 0;
  private resumed: string | null = null;

  constructor(push: (s: IvState) => void) {
    this.push = push;
  }

  set(patch: Partial<IvState>) {
    this.st = { ...this.st, ...patch };
    if (this.alive) this.push(this.st);
  }

  mount() {
    this.alive = true;
    const hr = new Date().getHours();
    this.greet = hr < 12 ? "Morning" : hr < 17 ? "Afternoon" : "Evening";
    this.st = IV_INIT;
    this.tg = 298;
    this.push(this.st);
    this.startStep(0);
  }

  destroy() {
    this.alive = false;
    this.clear();
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.scrollRaf);
    clearTimeout(this.toastT);
    this.chips.forEach((c) => c.remove());
    this.chips.clear();
  }

  private T(fn: () => void, ms: number) {
    this.timers.push(setTimeout(fn, ms));
  }
  private I(fn: () => void, ms: number) {
    const id = setInterval(fn, ms);
    this.intervals.push(id);
    return id;
  }
  private clear() {
    this.timers.forEach(clearTimeout);
    this.intervals.forEach(clearInterval);
    this.timers = [];
    this.intervals = [];
  }

  toast(m: string) {
    this.set({ toastMsg: m });
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => this.set({ toastMsg: null }), 2600);
  }

  private tween(t: number) {
    cancelAnimationFrame(this.raf);
    const from = this.st.display;
    if (prefersReducedMotion()) {
      this.set({ display: t });
      return;
    }
    const t0 = performance.now() + 250;
    const d = 800;
    const step = (now: number) => {
      const p = Math.max(0, Math.min(1, (now - t0) / d));
      const e = 1 - Math.pow(1 - p, 3);
      this.set({ display: Math.round(from + (t - from) * e) });
      if (p < 1) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  private startStep(i: number) {
    this.clear();
    const s: Partial<IvState> = { step: i, pos: -1, typed: 0, leaving: false };
    if (i === 0) s.counter = 0;
    if (i === 2) s.reveal = 0;
    if (i === 4) s.ticks = 0;
    if (i === 7) Object.assign(s, { ring: -1, moves: 0 });
    if (i > 0) s.counter = 23;
    if (i > 2) s.reveal = 6;
    if (i > 4) s.ticks = 4;
    if (i > 7) Object.assign(s, { ring: 3, moves: 3 });
    this.set(s);
    this.resumed = null;
    const el = this.bodyRef.current;
    if (el) el.scrollTop = 0;
    const t = SCORE[i];
    if (t !== this.tg) {
      this.tg = t;
      this.tween(t);
    }
    this.T(() => this.go(0), 300);
  }

  /** Called after the new block has rendered (the prototype's setState callback). */
  scrollDown() {
    cancelAnimationFrame(this.scrollRaf);
    this.scrollRaf = requestAnimationFrame(() => {
      const el = this.bodyRef.current;
      if (el && this.st.pos > 0)
        el.scrollTo({ top: el.scrollHeight, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    });
  }

  private gateOk(g: Gate) {
    const st = this.st;
    return g === "nmls"
      ? st.nmls
      : g === "phone"
        ? !!(st.phone && st.addr)
        : g === "mob"
          ? st.mob
          : st.twin === "out";
  }

  private go(pos: number) {
    const b = B[this.st.step][pos];
    if (!b) return;
    this.set({ pos, typed: 0 });
    if (b.l) return this.typeLine(pos, b.l);
    if (b.anim) return this.anim(b.anim, () => this.go(pos + 1));
    if (b.gate) {
      this.askT = Date.now();
      if (this.gateOk(b.gate)) this.T(() => this.go(pos + 1), 200);
      return;
    }
    if (b.w === "cta" || b.w === "finCta") {
      this.askT = Date.now();
      return;
    }
    this.T(() => this.go(pos + 1), 240);
  }

  private typeLine(pos: number, key: LineKey) {
    if (prefersReducedMotion()) {
      this.set({ typed: 9999 });
      this.T(() => this.go(pos + 1), 150);
      return;
    }
    const sp = this.quick ? 18 : 35;
    this.skipFlag = false;
    const id = this.I(() => {
      const L = segLen(lineText(this.st, key, this.greet));
      if (this.skipFlag || this.st.typed + 1 >= L) {
        clearInterval(id);
        this.skipFlag = false;
        this.set({ typed: 9999 });
        this.T(() => this.go(pos + 1), 320);
      } else this.set({ typed: this.st.typed + 1 });
    }, sp);
  }

  private anim(k: AnimKey, done: () => void) {
    const cfg: Record<AnimKey, [NumKey, number, number, number]> = {
      scan: ["counter", 23, 85, 0],
      clusters: ["reveal", 6, 420, 0],
      fixes: ["ticks", 4, 560, 200],
      grid: ["ring", 3, 375, 0],
      moves: ["moves", 3, 280, 0],
    };
    const [key, to, ms, delay] = cfg[k];
    if (prefersReducedMotion()) {
      this.setNum(key, to);
      this.T(done, 120);
      return;
    }
    this.T(() => {
      const id = this.I(() => {
        const v = this.st[key];
        if (v >= to) {
          clearInterval(id);
          this.T(done, 320);
        } else this.setNum(key, v + 1);
      }, ms);
    }, delay);
  }

  private setNum(key: NumKey, v: number) {
    const p: Partial<IvState> = {};
    p[key] = v;
    this.set(p);
  }

  /** Tap on a typing line: finish it now. */
  skip() {
    this.skipFlag = true;
  }

  private resume() {
    const { step, pos } = this.st;
    const b = B[step][pos];
    const key = step + ":" + pos;
    if (b && b.gate && this.gateOk(b.gate) && this.resumed !== key) {
      this.resumed = key;
      this.quick = Date.now() - this.askT < 3000;
      this.T(() => this.go(pos + 1), 260);
    }
  }

  next(el: HTMLElement | null) {
    const i = this.st.step;
    const lab = FLY[i];
    if (lab) this.fly(lab, el);
    this.quick = Date.now() - this.askT < 3000;
    this.clear();
    this.set({ leaving: true });
    this.T(() => this.startStep(i + 1), 280);
  }

  toggleSource(i: number) {
    const a = [...this.st.checks];
    a[i] = !a[i];
    this.set({ checks: a });
  }
  toggleProduct(n: string) {
    this.set({ products: { ...this.st.products, [n]: !this.st.products[n] } });
  }
  confirmNmls(el: HTMLElement) {
    if (this.st.nmls) return;
    this.fly("✓", el);
    this.set({ nmls: true });
    this.resume();
  }
  confirmMob(el: HTMLElement) {
    if (this.st.mob) return;
    this.fly("✓", el);
    this.set({ mob: true });
    this.resume();
  }
  pickPhone(v: string) {
    this.set({ phone: v });
    this.resume();
  }
  pickAddr(v: string) {
    this.set({ addr: v });
    this.resume();
  }
  notMe(el: HTMLElement) {
    if (this.st.twin === "out") return;
    this.fly("✓ Walled off", el);
    this.set({ twin: "out" });
    this.resume();
  }

  /** A "+N" chip flies from the tapped card into the score ring (600 ms). */
  private fly(label: string, el: HTMLElement | null) {
    if (prefersReducedMotion() || !el || typeof el.animate !== "function") return;
    const t = this.rootRef.current?.querySelector("[data-ring]");
    if (!t) return;
    const a = el.getBoundingClientRect();
    const b = t.getBoundingClientRect();
    const x0 = a.left + a.width / 2;
    const y0 = a.top + a.height / 2;
    const dx = b.left + b.width / 2 - x0;
    const dy = b.top + b.height / 2 - y0;
    const c = document.createElement("div");
    c.textContent = label;
    Object.assign(c.style, {
      position: "fixed",
      left: x0 + "px",
      top: y0 + "px",
      zIndex: "9999",
      padding: "6px 12px",
      borderRadius: "999px",
      background: "linear-gradient(135deg,#34a853,#1e8e3e)",
      color: "#fff",
      font: "700 14px Arial, sans-serif",
      boxShadow: "0 6px 16px rgba(30,142,62,.35)",
      pointerEvents: "none",
      whiteSpace: "nowrap",
      transform: "translate(-50%,-50%)",
    });
    document.body.appendChild(c);
    this.chips.add(c);
    const an = c.animate(
      [
        { transform: "translate(-50%,-50%) scale(1)", opacity: 1 },
        {
          transform: `translate(calc(-50% + ${dx * 0.45}px), calc(-50% + ${dy * 0.45 - 50}px)) scale(1.1)`,
          opacity: 1,
          offset: 0.45,
        },
        {
          transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.45)`,
          opacity: 0.15,
        },
      ],
      { duration: 600, easing: "cubic-bezier(.5,0,.3,1)" },
    );
    an.onfinish = () => {
      c.remove();
      this.chips.delete(c);
    };
  }
}
