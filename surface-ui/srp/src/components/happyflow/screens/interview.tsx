/**
 * Screen 3 — the NORA interview (sign-up step 3 of 3): ten beats in four phases (Find, Fix, Win,
 * Agree), the score climbing 298 → 384, ending on "Your SRP is live". Ported 1:1 from the Claude
 * Design prototype "Interview v2" with its demo data. No shell: the screen has its own frame.
 */
import { useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { HF_EMBED_HEIGHT, useHfNav } from "../seat-nav";
import "../happyflow.css";
import { PERSONA, GRID, HF_ASSETS } from "../demo-data";
import { Hov, Ic, NoraFace, Tick, useReducedMotion } from "../primitives";
import type { HfIconName } from "../icons";
import { useHfDevice } from "../use-hf-device";
import { useHfPersona, usePersonalize } from "../persona-context";
import {
  B,
  CLUSTERS,
  CTA,
  DONE,
  FOUND,
  IV_DOTC,
  IV_INIT,
  InterviewEngine,
  PGROUPS,
  PH,
  RIVER,
  SOURCES,
  sourcesFor,
  SRC6,
  dotCount,
  kept,
  lineText,
  parse,
  popped,
  reactText,
  segLen,
  type IvState,
  type Seg,
} from "./interview-engine";

const CARD: CSSProperties = {
  borderRadius: 20,
  background: "rgba(255,255,255,.95)",
  display: "flex",
  flexDirection: "column",
  boxShadow: "0 10px 28px rgba(66,133,244,.10)",
  animation: "hf-rise .32s ease both",
};
const BADGE: Record<string, [string, string]> = {
  g: ["#e6f4ea", "#137333"],
  b: ["#e8f0fe", "#1967d2"],
  r: ["#fce8e6", "#c5221f"],
  a: ["#fef7e0", "#b06000"],
  p: ["#f3e8fd", "#7b4ce0"],
};

/** The interview's own score ring: dot count grows with each beat, "SRS" label, ▲ delta, burst at the finale. */
function IvRing({ px, st, rm }: { px: number; st: IvState; rm: boolean }) {
  const d = st.display;
  const p = Math.max(0, Math.min(1, d / 850));
  const L = Math.PI * 40;
  const th = Math.PI * (1 - p);
  const R = 50;
  const mx = 70 + R * Math.cos(th);
  const my = 70 - R * Math.sin(th);
  const rot = 90 - (th * 180) / Math.PI;
  const n = dotCount(st);
  const gid = "hfIvSrsG" + px;
  const dots: ReactNode[][] = [[], []];
  for (let i = 0; i < n; i++) {
    const k = i % 2;
    const r = k ? 58 : 66;
    const a = ((Math.floor(i / 2) * 137.508 + (k ? 60 : 0)) * Math.PI) / 180;
    dots[k].push(
      <circle
        key={i}
        cx={+(70 + r * Math.cos(a)).toFixed(2)}
        cy={+(70 + r * Math.sin(a)).toFixed(2)}
        r={3.4}
        fill={IV_DOTC[i]}
        stroke="#fff"
        strokeWidth={1.2}
        style={{
          transformBox: "fill-box",
          transformOrigin: "center",
          animation: rm ? "none" : "hf-dotIn .55s cubic-bezier(.2,.8,.2,1) both",
        }}
      />,
    );
  }
  const orbit = (k: number, r: number, anim: string) => (
    <g key={"o" + k} style={{ transformOrigin: "70px 70px", animation: rm ? "none" : anim }}>
      <circle
        cx={70}
        cy={70}
        r={r}
        fill="none"
        stroke="#e1e5ee"
        strokeWidth={0.8}
        strokeDasharray={k ? "2 3" : undefined}
      />
      {dots[k]}
    </g>
  );
  const arc = "M30 70 A40 40 0 0 1 110 70";
  const delta = d - 298;
  return (
    <span
      data-ring="1"
      style={{ position: "relative", width: px, height: px, flexShrink: 0, display: "block" }}
    >
      {st.step === 9 ? (
        <span
          key="burst"
          style={{
            position: "absolute",
            inset: "-30%",
            borderRadius: "50%",
            background: "conic-gradient(from 0deg,#4285f4,#9b72f2,#ea4335,#fbbc04,#34a853,#4285f4)",
            filter: "blur(16px)",
            opacity: 0,
            animation: rm ? "none" : "hf-burstG 1.8s ease-out 1 both",
          }}
        />
      ) : null}
      <svg
        viewBox="0 0 140 140"
        width={px}
        height={px}
        style={{ position: "relative", display: "block", overflow: "visible" }}
      >
        <defs>
          <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1={30} y1={0} x2={110} y2={0}>
            <stop offset={0} stopColor="#ea4335" />
            <stop offset={0.5} stopColor="#fbbc04" />
            <stop offset={1} stopColor="#34a853" />
          </linearGradient>
        </defs>
        <circle cx={70} cy={70} r={62} fill="rgba(255,255,255,.94)" />
        {orbit(0, 66, "hf-orbit 90s linear infinite")}
        {orbit(1, 58, "hf-orbitR 120s linear infinite")}
        <path
          d={arc}
          fill="none"
          stroke={`url(#${gid})`}
          strokeOpacity={0.2}
          strokeWidth={9}
          strokeLinecap="round"
        />
        <path
          d={arc}
          fill="none"
          stroke={`url(#${gid})`}
          strokeWidth={9}
          strokeLinecap="round"
          strokeDasharray={`${(p * L).toFixed(2)} 400`}
        />
        <path
          d="M0 4 L-4.5 -3.5 L4.5 -3.5 Z"
          fill="#202124"
          transform={`translate(${mx.toFixed(2)} ${my.toFixed(2)}) rotate(${rot.toFixed(2)})`}
        />
        <text
          x={70}
          y={79}
          textAnchor="middle"
          style={{
            font: "700 30px Arial, sans-serif",
            fontVariantNumeric: "tabular-nums",
            fill: "#202124",
          }}
        >
          {String(d)}
        </text>
        <text
          x={70}
          y={94}
          textAnchor="middle"
          style={{ font: "700 10px Arial, sans-serif", fill: "#80868b", letterSpacing: "1.5px" }}
        >
          SRS
        </text>
        {delta > 0 ? (
          <text
            x={70}
            y={108}
            textAnchor="middle"
            style={{ font: "700 10px Arial, sans-serif", fill: "#1e8e3e" }}
          >
            {`▲ ${delta}`}
          </text>
        ) : null}
      </svg>
    </span>
  );
}

function SegText({ segs }: { segs: Seg[] }) {
  return (
    <>
      {segs.map((s, i) =>
        s.k === "p" ? (
          <span key={i}>{s.t}</span>
        ) : s.k === "b" ? (
          <b key={i}>{s.t}</b>
        ) : s.k === "n" ? (
          <span
            key={i}
            style={{
              fontWeight: 700,
              background: "#e8f0fe",
              color: "#1967d2",
              borderRadius: 6,
              padding: "1px 6px",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {s.t}
          </span>
        ) : (
          <span key={i} style={{ fontWeight: 700, color: "#1a73e8" }}>
            {s.t}
          </span>
        ),
      )}
    </>
  );
}

const confStyle = (on: boolean) => ({
  cta: on ? "#137333" : "#1a73e8",
  label: on ? "Confirmed" : "Confirm",
  bd: on ? "#ceead6" : "#e3e7f0",
  bg: on ? "#f6fbf7" : "#fff",
  boxBd: on ? "#34a853" : "#dadce0",
  boxBg: on ? "#34a853" : "#fff",
});
const pickStyle = (curV: string | null, v: string) => ({
  sel: curV === v,
  bd: curV === v ? "#1a73e8" : "#eceef1",
  bg: curV === v ? "#f5f9ff" : "#fafbfc",
  ring: curV === v ? "2px solid #1a73e8" : "2px solid #dadce0",
});

const FAKE_NAV = ["Home", "Profile", "SRS", "Insights", "Listings", "Reviews", "Connections"];

export function InterviewScreen() {
  const persona = useHfPersona();
  const t = usePersonalize();
  const [st, setSt] = useState<IvState>(IV_INIT);
  const [eng] = useState(() => new InterviewEngine(setSt));
  const { isD, isM, framed } = useHfDevice();
  const rm = useReducedMotion();
  const hfNav = useHfNav();

  useEffect(() => {
    eng.mount();
    return () => eng.destroy();
  }, [eng]);

  useEffect(() => {
    if (st.pos > 0) eng.scrollDown();
  }, [eng, st.step, st.pos]);

  const c = st.step;
  const list = B[c];
  const cur = list[st.pos] || {};
  const animating = !!cur.anim;
  const typingNow = !!cur.l && st.typed < 9999;
  const mood = typingNow || animating ? "working" : [2, 4, 7, 9].includes(c) ? "done" : "idle";
  const faceEl = (
    <NoraFace
      size={isD ? 40 : 36}
      mood={mood}
      shadow="0 6px 18px rgba(155,114,242,.35)"
      burstKey={"b" + c}
    />
  );
  const keptL = kept(st);
  const keptN = keptL.length;
  const compareAt = list.findIndex((x) => x.w === "compare");

  const phOld = st.phone === "(563) 555-0177" ? "(563) 555-0100" : "(563) 555-0177";
  const phNew = st.phone || "(563) 555-0100";
  const adNew = (st.addr || "100 Main St").split(",")[0];
  const adOld = adNew === "2200 E Kimberly Rd" ? "100 Main St" : "2200 E Kimberly Rd";
  const fixRows: [string, string, string][] = [
    ["Zillow", phOld, phNew],
    ["Yelp", adOld, adNew],
    ["Yellow Pages directory", phOld, phNew],
    ["Manta directory", adOld, adNew],
  ];
  const ringRev = c > 7 ? 3 : c === 7 ? st.ring : -1;
  const factsNow =
    c === 0
      ? st.counter
      : c === 1
        ? 23
        : c === 2
          ? Math.max(
              23,
              CLUSTERS.slice(0, st.reveal).reduce((a, x) => a + x[1], 0),
            )
          : 67;
  const contactBadge: [string, string] =
    c >= 5
      ? ["Same in 4 places", "g"]
      : c === 4
        ? [`Fixing ${st.ticks} of 4`, "b"]
        : st.phone && st.addr
          ? ["Settled", "g"]
          : ["2 numbers · needs you", "r"];
  const cl: Record<string, { rows: string[]; badge: [string, string] | null; fresh: boolean }> = {
    Identity: {
      rows: [
        "Demo Mortgage Co — Davenport Branch",
        "12 years in mortgage",
        "demomortgage.com/alex-sample",
      ],
      badge: c >= 6 ? ["Tampa agent walled off", "b"] : null,
      fresh: c === 5 && st.twin === "out",
    },
    Contact: {
      rows: st.phone
        ? [phNew + (st.mob ? " · mobile (563) 555-0144" : ""), adNew + ", Davenport, IA"]
        : ["(563) 555-0100 · (563) 555-0177", "100 Main St · 2200 E Kimberly Rd"],
      badge: contactBadge,
      fresh: (c === 3 && !!st.phone) || c === 4,
    },
    Licence: {
      rows: ["NMLS 482913", "Iowa · Illinois"],
      badge: st.nmls ? ["Confirmed by you", "g"] : ["To check with you", "a"],
      fresh: c === 3 && st.nmls,
    },
    Products: {
      rows: [keptL.slice(0, 5).join(" · ") + (keptN > 5 ? ` +${keptN - 5}` : "")],
      badge: c >= 7 ? [`${keptN} · a page for each`, "b"] : [`${keptN} found on your site`, "p"],
      fresh: c === 6,
    },
    Reviews: { rows: ["4.9 ★ from 128 reviews", "Google · Zillow"], badge: null, fresh: false },
    Presence: {
      rows: [
        'YouTube · "FHA loans explained in 4 minutes"',
        "Quad Cities Home Hour · episode 31",
        "LinkedIn · Facebook",
      ],
      badge: null,
      fresh: false,
    },
  };
  const visC = c < 2 ? 0 : c === 2 ? st.reveal : 6;
  const pClusters = CLUSTERS.slice(0, visC).map(([label, n, color], i) => {
    const x = cl[label];
    const fr = x.fresh || (c === 2 && i === st.reveal - 1);
    return {
      label,
      n,
      color,
      rows: x.rows,
      badge: x.badge ? x.badge[0] : "",
      bbg: x.badge ? BADGE[x.badge[1]][0] : "",
      bfg: x.badge ? BADGE[x.badge[1]][1] : "",
      bd: fr ? "1.5px solid #a8c7fa" : "1.5px solid transparent",
      sh: fr ? "0 0 0 4px rgba(66,133,244,.10)" : "0 2px 8px rgba(60,64,67,.04)",
      span: label === "Presence" || label === "Products" ? "1 / -1" : "auto",
    };
  });
  const lit = (on: boolean, partial: boolean) =>
    on
      ? { bg: "#e8f0fe", fg: "#1967d2" }
      : partial
        ? { bg: "#f3eefe", fg: "#7b4ce0" }
        : { bg: "rgba(255,255,255,.6)", fg: "#9aa0a6" };
  const mapOn = (c === 7 && st.ring >= 0) || c > 7;
  const prodOn = c >= 7;
  const strip = (
    [
      ["Profile", "user", c >= 2, c < 2 && st.counter > 0],
      ["Licence", "badge", st.nmls, false],
      ["Products", "list", prodOn, c === 6],
      ["Map", "pin", mapOn, false],
    ] as [string, HfIconName, boolean, boolean][]
  ).map(([label, icon, on, part]) => ({
    label,
    icon,
    ...lit(on, part),
    anim: on ? "hf-lit 1s ease-out 1" : "none",
  }));
  const stripNote = mapOn
    ? "Map · 49 spots"
    : prodOn
      ? `Products · ${keptN} selected`
      : st.nmls
        ? "Licence · confirmed by you"
        : `Profile · ${factsNow} facts`;
  const doneStack = DONE.slice(0, c)
    .map(([t, pts]) => ({ t: t.replace("#", String(keptN)), pts }))
    .reverse();
  const phases = PH.map(([label, idx, pts]) => {
    const dn = c > idx[idx.length - 1];
    const act = idx.includes(c);
    return {
      label,
      pts: dn ? pts : "",
      dn,
      fg: dn ? "#137333" : act ? "#1967d2" : "#9aa0a6",
      segs: idx.map((i) => (i < c ? "#34a853" : i === c ? "#1a73e8" : "rgba(26,115,232,.14)")),
    };
  });
  const cellBig = isD ? 38 : 36;
  const cellSm = isD ? 16 : 14;
  const factsBig = Math.max(
    0,
    CLUSTERS.slice(0, c === 2 ? st.reveal : 6).reduce((a, x) => a + x[1], 0),
  );
  const finishLater = () => eng.toast("Saved — I'll keep going and pick this up with you later");
  const nmlsC = confStyle(st.nmls);
  const mobC = confStyle(st.mob);
  const twinOut = st.twin === "out";
  const liveDot = c === 9 ? "#34a853" : "#9b72f2";
  const paneLabel = c === 9 ? "YOUR SRP · LIVE" : "YOUR SRP, BUILDING LIVE";
  const showFound = c < 2 && st.counter > 0;
  const paneFound =
    c === 0
      ? SRC6.slice(0, popped(st)).map(([n, k, color]) => ({
          n: `${n} · ${k}`,
          color,
          bg: "#f5f7fb",
          fg: "#202124",
          td: "none",
        }))
      : SOURCES.map(([, src], i) => ({
          n: src,
          color: st.checks[i] ? "#4285f4" : "#dadce0",
          bg: st.checks[i] ? "#f5f9ff" : "#fafbfc",
          fg: st.checks[i] ? "#202124" : "#9aa0a6",
          td: st.checks[i] ? "none" : "line-through",
        }));
  const ctaOn = (e: MouseEvent<HTMLElement>) => eng.next(e.currentTarget);
  const radio = (sel: boolean, ring: string) => (
    <span
      style={{
        width: 22,
        height: 22,
        flex: "none",
        borderRadius: "50%",
        border: ring,
        display: "grid",
        placeItems: "center",
      }}
    >
      {sel ? (
        <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#1a73e8" }} />
      ) : null}
    </span>
  );

  const renderWidget = (wd: string, key: string): ReactNode => {
    switch (wd) {
      case "chips":
        return (
          <div key={key} style={{ ...CARD, padding: 16, gap: 12 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span
                style={{
                  fontSize: 44,
                  fontWeight: 700,
                  letterSpacing: "-0.04em",
                  lineHeight: 1,
                  fontVariantNumeric: "tabular-nums",
                  background: "linear-gradient(135deg,#4285f4,#9b72f2 60%,#ea4335)",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                }}
              >
                {st.counter}
              </span>
              <span style={{ fontSize: 14, color: "#5f6368" }}>facts so far</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {SRC6.slice(0, popped(st)).map(([n, k, color]) => (
                <span
                  key={n}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    height: 32,
                    borderRadius: 999,
                    background: "#fff",
                    border: "1px solid #e8eaed",
                    padding: "0 12px 0 10px",
                    fontSize: 13,
                    fontWeight: 600,
                    animation: "hf-pop .45s cubic-bezier(.2,.8,.2,1) both",
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
                  {n}
                  <b style={{ color: "#137333", fontSize: 11 }}>+{k}</b>
                </span>
              ))}
            </div>
          </div>
        );
      case "sources":
        return (
          <div key={key} style={{ ...CARD, padding: 12, gap: 6 }}>
            {sourcesFor(persona).map(([n, src], i) => {
              const on = st.checks[i];
              return (
                <button
                  key={n + src}
                  type="button"
                  aria-pressed={on}
                  onClick={() => eng.toggleSource(i)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    minHeight: 50,
                    borderRadius: 14,
                    border: `1.5px solid ${on ? "#c6dafc" : "#eceef1"}`,
                    background: on ? "#f5f9ff" : "#fafbfc",
                    padding: "8px 12px",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      flex: "none",
                      borderRadius: 7,
                      border: `1.5px solid ${on ? "#1a73e8" : "#dadce0"}`,
                      background: on ? "#1a73e8" : "#fff",
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    {on ? <Tick size={12} /> : null}
                  </span>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: on ? "#202124" : "#9aa0a6",
                        textDecoration: on ? "none" : "line-through",
                      }}
                    >
                      {n}
                    </span>
                    <span style={{ fontSize: 11, color: "#80868b" }}>{src}</span>
                  </div>
                </button>
              );
            })}
          </div>
        );
      case "clusters":
        return (
          <div key={key} style={{ ...CARD, padding: 16, gap: 12 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span
                style={{
                  fontSize: 44,
                  fontWeight: 700,
                  letterSpacing: "-0.04em",
                  lineHeight: 1,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {factsBig}
              </span>
              <span style={{ fontSize: 14, color: "#5f6368" }}>facts in one record</span>
            </div>
            <div
              style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}
            >
              {CLUSTERS.map(([label, n, color], i) => {
                const on = c > 2 || i < st.reveal;
                return (
                  <div
                    key={label}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      borderRadius: 12,
                      padding: "11px 12px",
                      background: on ? "#f5f9ff" : "#f6f7f9",
                      opacity: on ? 1 : 0.55,
                      transition: "background .35s,opacity .35s",
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{label}</span>
                    <b
                      style={{ fontSize: 13, color: "#1a73e8", fontVariantNumeric: "tabular-nums" }}
                    >
                      {on ? n : "—"}
                    </b>
                  </div>
                );
              })}
            </div>
          </div>
        );
      case "nmls":
      case "mob": {
        const isN = wd === "nmls";
        const cf = isN ? nmlsC : mobC;
        const on = isN ? st.nmls : st.mob;
        return (
          <button
            key={key}
            type="button"
            onClick={(e) =>
              isN ? eng.confirmNmls(e.currentTarget) : eng.confirmMob(e.currentTarget)
            }
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              borderRadius: 16,
              border: `1.5px solid ${cf.bd}`,
              background: cf.bg,
              padding: 14,
              textAlign: "left",
              cursor: "pointer",
              boxShadow: "0 6px 18px rgba(66,133,244,.08)",
              animation: "hf-rise .32s ease both",
            }}
          >
            <span
              style={{
                width: 24,
                height: 24,
                flex: "none",
                borderRadius: "50%",
                border: `1.5px solid ${cf.boxBd}`,
                background: cf.boxBg,
                display: "grid",
                placeItems: "center",
              }}
            >
              {on ? <Tick size={12} /> : null}
            </span>
            {isN ? (
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>NMLS 482913</div>
                <div style={{ fontSize: 12, color: "#5f6368" }}>
                  Iowa · Illinois · so your licence shows on every page
                </div>
              </div>
            ) : (
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                  Mobile (563) 555-0144
                </div>
                <div style={{ fontSize: 12, color: "#5f6368" }}>From LinkedIn</div>
              </div>
            )}
            <span style={{ fontSize: 12, fontWeight: 700, color: cf.cta }}>{cf.label}</span>
          </button>
        );
      }
      case "phone": {
        const head: CSSProperties = {
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: ".08em",
          color: "#c5221f",
          padding: "2px 4px",
        };
        const opt = (
          v: string,
          src: string,
          curV: string | null,
          onPick: () => void,
          tab: boolean,
        ) => {
          const o = pickStyle(curV, v);
          return (
            <button
              key={v}
              type="button"
              aria-pressed={o.sel}
              onClick={onPick}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                borderRadius: 14,
                border: `1.5px solid ${o.bd}`,
                background: o.bg,
                padding: "11px 12px",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              {radio(o.sel, o.ring)}
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    ...(tab ? { fontVariantNumeric: "tabular-nums" } : null),
                  }}
                >
                  {v}
                </div>
                <div style={{ fontSize: 12, color: "#5f6368" }}>{src}</div>
              </div>
            </button>
          );
        };
        return (
          <div key={key} style={{ ...CARD, padding: 12, gap: 6 }}>
            <span style={head}>OFFICE PHONE</span>
            {(
              [
                ["(563) 555-0100", "On your website and Google"],
                ["(563) 555-0177", "On Zillow · old branch line"],
              ] as [string, string][]
            ).map(([v, src]) => opt(v, src, st.phone, () => eng.pickPhone(v), true))}
            <span style={{ ...head, padding: "8px 4px 2px" }}>
              OFFICE ADDRESS · SO BUYERS FIND THE RIGHT BRANCH
            </span>
            {(
              [
                ["100 Main St, Davenport, IA 52801", "On your website and Google"],
                ["2200 E Kimberly Rd", "On Yelp · last updated 2021"],
              ] as [string, string][]
            ).map(([v, src]) => opt(v, src, st.addr, () => eng.pickAddr(v), false))}
          </div>
        );
      }
      case "fixes":
        return (
          <div key={key} style={{ ...CARD, padding: 12, gap: 6 }}>
            {fixRows.map(([n, old, nw], i) => {
              const dn = i < st.ticks;
              const busy = i === st.ticks && c === 4;
              return (
                <div
                  key={n}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    borderRadius: 14,
                    background: dn ? "#f6fbf7" : busy ? "#f8f6fe" : "#fafbfc",
                    padding: "11px 12px",
                    transition: "background .3s",
                  }}
                >
                  <span
                    style={{
                      width: 24,
                      height: 24,
                      flex: "none",
                      borderRadius: "50%",
                      display: "grid",
                      placeItems: "center",
                      background: dn ? "#34a853" : busy ? "transparent" : "#eceef1",
                    }}
                  >
                    {busy ? (
                      <span
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: "50%",
                          border: "2px solid #d7c6f7",
                          borderTopColor: "#7b4ce0",
                          animation: "hf-nSpin .8s linear infinite",
                        }}
                      />
                    ) : null}
                    {dn ? <Tick size={12} /> : null}
                  </span>
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{n}</span>
                    <span
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 12,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      <span style={{ color: "#c5221f", textDecoration: "line-through" }}>
                        {old}
                      </span>
                      <span style={{ color: "#80868b" }}>→</span>
                      <span style={{ fontWeight: 700, color: dn ? "#137333" : "#9aa0a6" }}>
                        {nw}
                      </span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        );
      case "fixDone":
        return (
          <div
            key={key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              borderRadius: 14,
              background: "#e6f4ea",
              padding: "12px 14px",
              animation: "hf-rise .32s ease both",
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                flex: "none",
                borderRadius: "50%",
                background: "#34a853",
                display: "grid",
                placeItems: "center",
              }}
            >
              <Tick size={13} />
            </span>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#137333" }}>
              One number, one address everywhere.
            </span>
          </div>
        );
      case "twin": {
        const wallBg = twinOut ? "#1a73e8" : "#e3e7f0";
        const wallDot = twinOut ? "#1a73e8" : "#dadce0";
        const person: CSSProperties = {
          borderRadius: 16,
          padding: 12,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          textAlign: "center",
        };
        return (
          <div key={key} style={{ ...CARD, padding: 14, gap: 12 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)",
                gap: 10,
                alignItems: "stretch",
              }}
            >
              <div style={{ ...person, background: "#f5f9ff", border: "1.5px solid #c6dafc" }}>
                <img
                  src={PERSONA.photo}
                  alt=""
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    objectFit: "cover",
                    objectPosition: "50% 22%",
                  }}
                />
                <span style={{ fontSize: 13, fontWeight: 700 }}>You</span>
                <span style={{ fontSize: 11, color: "#5f6368" }}>
                  Loan officer · <b style={{ color: "#1a73e8" }}>Davenport</b>
                </span>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#1967d2" }}>NMLS 482913</span>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                <span
                  style={{
                    width: 2,
                    flex: 1,
                    borderRadius: 1,
                    background: wallBg,
                    transition: "background .4s",
                  }}
                />
                <span
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    display: "grid",
                    placeItems: "center",
                    background: wallDot,
                    color: "#fff",
                    transition: "background .4s",
                  }}
                >
                  <Ic name="lock" size={13} color="#fff" sw={2.4} />
                </span>
                <span
                  style={{
                    width: 2,
                    flex: 1,
                    borderRadius: 1,
                    background: wallBg,
                    transition: "background .4s",
                  }}
                />
              </div>
              <div
                style={{
                  ...person,
                  background: "#f8f9fb",
                  border: "1.5px solid #eceef1",
                  transition:
                    "transform .7s cubic-bezier(.2,.8,.2,1),opacity .7s ease,filter .7s ease",
                  transform: twinOut ? "translateX(26px) scale(.92)" : "none",
                  opacity: twinOut ? 0.3 : 1,
                  filter: twinOut ? "grayscale(1)" : "none",
                }}
              >
                <img
                  src={HF_ASSETS.sampleTampaPhoto}
                  alt=""
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    objectFit: "cover",
                    objectPosition: "50% 30%",
                  }}
                />
                <span style={{ fontSize: 13, fontWeight: 700 }}>{persona.name}</span>
                <span style={{ fontSize: 11, color: "#5f6368" }}>
                  Real estate agent · <b style={{ color: "#1a73e8" }}>Tampa</b>
                </span>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#5f6368" }}>
                  FL real estate licence
                </span>
              </div>
            </div>
            {!twinOut ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Hov
                  onClick={(e: MouseEvent<HTMLElement>) => eng.notMe(e.currentTarget)}
                  style={{
                    height: 50,
                    borderRadius: 14,
                    border: 0,
                    background: "#1a73e8",
                    font: "700 15px Arial,sans-serif",
                    color: "#fff",
                    cursor: "pointer",
                  }}
                  hover={{ background: "#1557b0" }}
                >
                  This is not me
                </Hov>
                <button
                  type="button"
                  onClick={() =>
                    eng.toast(
                      "Her licence is Florida real estate, not NMLS — I'll keep her separate",
                    )
                  }
                  style={{
                    height: 46,
                    borderRadius: 14,
                    border: "1px solid #dadce0",
                    background: "#fff",
                    font: "600 15px Arial,sans-serif",
                    color: "#3c4043",
                    cursor: "pointer",
                  }}
                >
                  That&apos;s also me
                </button>
              </div>
            ) : (
              <span
                style={{
                  alignSelf: "center",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  borderRadius: 999,
                  background: "#e8f0fe",
                  padding: "5px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#1967d2",
                  animation: "hf-rise .3s ease both",
                }}
              >
                <Ic name="lock" size={12} color="#1967d2" sw={2.4} />
                Kept out of your record
              </span>
            )}
          </div>
        );
      }
      case "products":
        return (
          <div key={key} style={{ ...CARD, padding: 16, gap: 14 }}>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "#5f6368",
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#9b72f2" }} />
              Found on your site
            </span>
            {PGROUPS.map(([g, items]) => (
              <div key={g} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: ".1em",
                    textTransform: "uppercase",
                    color: "#80868b",
                  }}
                >
                  {g}
                </span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {items.map((n) => {
                    const on = st.products[n];
                    return (
                      <button
                        key={n}
                        type="button"
                        aria-pressed={on}
                        onClick={() => eng.toggleProduct(n)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          height: 34,
                          borderRadius: 999,
                          border: `1.5px solid ${on ? "#c6dafc" : "#e3e5e8"}`,
                          background: on ? "#e8f0fe" : "#fff",
                          padding: "0 12px 0 10px",
                          font: "600 13px Arial,sans-serif",
                          color: on ? "#1967d2" : "#5f6368",
                          cursor: "pointer",
                          transition: "background .2s,border-color .2s",
                        }}
                      >
                        {on ? (
                          <Tick size={12} color="#1967d2" />
                        ) : (
                          <Ic name="plus" size={12} color="#9aa0a6" sw={2.4} />
                        )}
                        {n}
                        {FOUND.has(n) ? (
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              background: "#9b72f2",
                            }}
                          />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => eng.toast("Type the product name and I'll add it to your record")}
              style={{
                alignSelf: "flex-start",
                border: "1.5px dashed #c6dafc",
                background: "#fff",
                borderRadius: 999,
                height: 34,
                padding: "0 14px",
                font: "700 13px Arial,sans-serif",
                color: "#1a73e8",
                cursor: "pointer",
              }}
            >
              + Add a product I offer
            </button>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                borderRadius: 12,
                background: "#e8f0fe",
                padding: "10px 12px",
                fontSize: 13,
                color: "#1967d2",
              }}
            >
              <b style={{ fontSize: 16, fontVariantNumeric: "tabular-nums" }}>{keptN}</b>
              <span>selected · I&apos;ll build a page for each.</span>
            </div>
          </div>
        );
      case "grid":
        return (
          <div key={key} style={{ ...CARD, padding: 16, alignItems: "center", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(7,${cellBig}px)`, gap: 4 }}>
              {GRID.map((x) => {
                const on = x.ring <= ringRev;
                return (
                  <span
                    key={x.i}
                    style={{
                      width: cellBig,
                      height: cellBig,
                      borderRadius: 8,
                      background: x.bg,
                      opacity: on ? 1 : 0.07,
                      transform: `scale(${on ? 1 : 0.6})`,
                      transition: "opacity .35s,transform .35s",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 11,
                      fontWeight: 700,
                      color: x.fg,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {x.i === 24 ? "●" : String(x.rank)}
                  </span>
                );
              })}
            </div>
            <span style={{ fontSize: 12, color: "#5f6368" }}>
              Your rank in each spot around <b style={{ color: "#1a73e8" }}>100 Main St</b>
            </span>
          </div>
        );
      case "compare": {
        const mini = (cells: { bg: string }[], who: string, n: number, col: string) => (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
              textAlign: "center",
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: `repeat(7,${cellSm}px)`, gap: 2 }}>
              {cells.map((g, i) => (
                <span
                  key={i}
                  style={{ width: cellSm, height: cellSm, borderRadius: 3, background: g.bg }}
                />
              ))}
            </div>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{who}</span>
            <span style={{ fontSize: 12, color: "#5f6368" }}>
              Top 3 in <b style={{ fontSize: 16, color: col }}>{n}</b> of 49
            </span>
          </div>
        );
        return (
          <div
            key={key}
            style={{
              ...CARD,
              padding: 16,
              display: "grid",
              gridTemplateColumns: "repeat(2,minmax(0,1fr))",
              gap: 14,
            }}
          >
            {mini(GRID, "You", 9, "#137333")}
            {mini(RIVER, "Riverbend Bank & Trust", 34, "#c5221f")}
          </div>
        );
      }
      case "rank":
        return (
          <div key={key} style={{ ...CARD, padding: 10, gap: 4 }}>
            {(
              [
                ["#1", "Riverbend Bank & Trust"],
                ["#2", "Prairie Home Lending"],
                ["#3", "Bluff City Mortgage"],
                ["…", "Two more lenders"],
                ["#6", "You"],
              ] as [string, string][]
            ).map(([r, n]) => (
              <div
                key={r + n}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  borderRadius: 10,
                  padding: "9px 12px",
                  background: n === "You" ? "#e8f0fe" : "transparent",
                  fontSize: 13,
                  fontWeight: n === "You" ? 700 : 400,
                  color: n === "You" ? "#1967d2" : r === "…" ? "#9aa0a6" : "#202124",
                }}
              >
                <span style={{ width: 28, color: "#80868b", fontVariantNumeric: "tabular-nums" }}>
                  {r}
                </span>
                <span style={{ flex: 1 }}>{n}</span>
              </div>
            ))}
          </div>
        );
      case "moves":
        return (
          <div key={key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(
              [
                ["Add your Google category and services", "I'll do it", "+6"],
                ["Turn your FHA video into 4 articles", "I'll do it", "+24"],
                ["Ask your last 10 closings for a review", "You · I'll draft the texts", "+15"],
              ] as [string, string, string][]
            )
              .slice(0, st.moves)
              .map(([t, who, pts], i) => (
                <div
                  key={t}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    borderRadius: 16,
                    background: "rgba(255,255,255,.95)",
                    padding: "12px 14px",
                    boxShadow: "0 6px 18px rgba(66,133,244,.08)",
                    animation: "hf-pop .45s cubic-bezier(.2,.8,.2,1) both",
                  }}
                >
                  <span
                    style={{
                      width: 26,
                      height: 26,
                      flex: "none",
                      borderRadius: "50%",
                      background: "linear-gradient(135deg,#4285f4,#9b72f2)",
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: 700,
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    {i + 1}
                  </span>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{t}</span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: i < 2 ? "#7b4ce0" : "#b06000",
                      }}
                    >
                      {who}
                    </span>
                  </div>
                  <b style={{ fontSize: 13, color: "#137333" }}>{pts}</b>
                </div>
              ))}
          </div>
        );
      case "work":
        return (
          <div key={key} style={{ ...CARD, padding: 10, gap: 4 }}>
            {(
              [
                ["cal", "When", "Weekday mornings"],
                ["msg", "Text", "(563) 555-0144"],
                ["mail", "Email", "alex.sample@demomortgage.com"],
              ] as [HfIconName, string, string][]
            ).map(([icon, k, v]) => (
              <div
                key={k}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  borderRadius: 12,
                  padding: 10,
                }}
              >
                <span
                  style={{
                    width: 36,
                    height: 36,
                    flex: "none",
                    borderRadius: 12,
                    background: "#e8f0fe",
                    display: "grid",
                    placeItems: "center",
                    color: "#1a73e8",
                  }}
                >
                  <Ic name={icon} size={17} />
                </span>
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 11, color: "#80868b" }}>{k}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, wordBreak: "break-word" }}>
                    {v}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => eng.toast("Pick another time or channel")}
                  style={{
                    border: 0,
                    background: "none",
                    padding: 0,
                    font: "700 12px Arial,sans-serif",
                    color: "#1a73e8",
                    cursor: "pointer",
                  }}
                >
                  Change
                </button>
              </div>
            ))}
          </div>
        );
      case "finale":
        return (
          <div
            key={key}
            style={{
              borderRadius: 22,
              background: "rgba(255,255,255,.96)",
              padding: 18,
              display: "flex",
              flexDirection: "column",
              gap: 14,
              boxShadow: "0 14px 36px rgba(66,133,244,.14)",
              animation: "hf-rise .4s ease both",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  width: 28,
                  height: 28,
                  flex: "none",
                  borderRadius: "50%",
                  background: "#34a853",
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <Tick size={13} />
              </span>
              <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}>
                Your SRP is{" "}
                <span
                  style={{
                    background: "linear-gradient(135deg,#4285f4,#9b72f2 40%,#ea4335 75%,#fbbc04)",
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    color: "transparent",
                  }}
                >
                  live.
                </span>
              </span>
            </div>
            <div
              style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}
            >
              {(
                [
                  ["Search Rank Score", "298", "384", "1 / -1", "#e6f4ea", "#137333"],
                  ["Facts", "0", "67"],
                  ["Places fixed", "", "4"],
                  ["Competitors mapped", "", "5"],
                  ["Products", "", String(keptN)],
                ] as string[][]
              ).map(([k, from, to, span, bg, fg], i) => (
                <div
                  key={k}
                  style={{
                    gridColumn: span || "auto",
                    borderRadius: 14,
                    background: bg || "#f5f7fb",
                    padding: "12px 14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    animation: `hf-rise .4s ease ${i * 80}ms both`,
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#5f6368" }}>{k}</span>
                  <span
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 8,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {from ? (
                      <>
                        <span style={{ fontSize: 16, color: "#9aa0a6" }}>{from}</span>
                        <span style={{ fontSize: 14, color: "#9aa0a6" }}>→</span>
                      </>
                    ) : null}
                    <span
                      style={{
                        fontSize: 28,
                        fontWeight: 700,
                        letterSpacing: "-0.02em",
                        lineHeight: 1,
                        color: fg || "#202124",
                      }}
                    >
                      {to}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      case "task":
        return (
          <div
            key={key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              borderRadius: 14,
              background: "#e8f0fe",
              padding: "12px 14px",
              animation: "hf-rise .32s ease both",
            }}
          >
            <span
              style={{
                width: 16,
                height: 16,
                flex: "none",
                borderRadius: "50%",
                border: "2px solid #c6dafc",
                borderTopColor: "#1a73e8",
                animation: "hf-nSpin .8s linear infinite",
              }}
            />
            <span style={{ fontSize: 14, fontWeight: 700, color: "#1967d2" }}>
              Adding your Google category and services…
            </span>
          </div>
        );
      case "cta":
        return (
          <Hov
            key={key}
            onClick={ctaOn}
            style={{
              height: 52,
              borderRadius: 14,
              border: 0,
              background: "#1a73e8",
              font: "700 15px Arial,sans-serif",
              color: "#fff",
              cursor: "pointer",
              boxShadow: "0 10px 24px rgba(26,115,232,.28)",
              animation: "hf-rise .32s ease both",
            }}
            hover={{ background: "#1557b0" }}
          >
            {CTA[c] || ""}
          </Hov>
        );
      case "finCta":
        return (
          <div
            key={key}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              animation: "hf-rise .32s ease both",
            }}
          >
            <Hov
              as="a"
              href="#"
              onClick={(e: MouseEvent<HTMLAnchorElement>) => {
                e.preventDefault();
                hfNav("home");
              }}
              style={{
                flex: 1,
                minHeight: 52,
                borderRadius: 14,
                background: "#1a73e8",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                font: "700 15px Arial,sans-serif",
                color: "#fff",
                boxShadow: "0 10px 24px rgba(26,115,232,.28)",
              }}
              hover={{ background: "#1557b0", color: "#fff" }}
            >
              Go to my dashboard
            </Hov>
            <button
              type="button"
              onClick={() =>
                eng.toast("Opens your public profile · demomortgage.com/alex-sample")
              }
              style={{
                border: 0,
                background: "none",
                padding: "6px 0",
                font: "700 14px Arial,sans-serif",
                color: "#1a73e8",
                cursor: "pointer",
              }}
            >
              See my public profile
            </button>
          </div>
        );
      default:
        return null;
    }
  };

  // The conversation: every block up to the current position of this beat.
  const blocks: ReactNode[] = [];
  let firstLine = true;
  for (let i = 0; i <= st.pos && i < list.length; i++) {
    const b = list[i];
    const key = `${c}-${i}`;
    if (b.w === "grid" && compareAt >= 0 && st.pos >= compareAt) continue;
    if (b.l || b.w === "srcReact" || b.w === "offerReact") {
      const txt = b.l
        ? lineText(st, b.l, eng.greet, persona)
        : reactText(st, b.w as "srcReact" | "offerReact");
      if (!txt) continue;
      const full = i < st.pos || !b.l || st.typed >= segLen(txt);
      let left = full ? 1e9 : st.typed;
      const segs = parse(txt).map((s) => {
        const t = s.t.slice(0, Math.max(0, left));
        left -= s.t.length;
        return { t, k: s.k };
      });
      const face = b.l && firstLine ? faceEl : null;
      if (b.l) firstLine = false;
      blocks.push(
        <div
          key={key}
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
            animation: "hf-rise .32s ease both",
          }}
        >
          <span style={{ width: isD ? 40 : 36, flex: "none", display: "flex" }}>{face}</span>
          <div
            role="button"
            tabIndex={0}
            aria-label="Skip typing"
            onClick={() => eng.skip()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") eng.skip();
            }}
            style={{
              flex: 1,
              minWidth: 0,
              borderRadius: "4px 18px 18px 18px",
              background: "rgba(255,255,255,.95)",
              padding: "11px 15px",
              boxShadow: "0 6px 18px rgba(66,133,244,.08)",
              cursor: "pointer",
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: isD ? 16 : 15,
                lineHeight: 1.5,
                color: "#202124",
                textWrap: "pretty",
              }}
            >
              <SegText segs={segs} />
              {!full ? (
                <span
                  style={{
                    display: "inline-block",
                    width: 2,
                    height: 15,
                    marginLeft: 1,
                    verticalAlign: -2,
                    background: "#7b4ce0",
                    animation: "hf-caret 1s steps(1) infinite",
                  }}
                />
              ) : null}
            </p>
          </div>
        </div>,
      );
    } else if (b.w) blocks.push(renderWidget(b.w, key));
  }

  const ring = (px: number) => <IvRing px={px} st={st} rm={rm} />;

  return (
    <div className="hf-root">
      <div
        ref={eng.rootRef}
        style={{
          borderRadius: framed ? 24 : 0,
          background: framed ? "#e8eaed" : "#f7f8fc",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <div
          style={{
            position: "relative",
            width: framed ? "390px" : "100%",
            height: framed ? "min(844px, calc(100vh - 32px))" : HF_EMBED_HEIGHT,
            borderRadius: framed ? "32px" : "0",
            boxShadow: framed ? "0 20px 60px rgba(32,33,36,.22), 0 0 0 1px #dadce0" : "none",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            backgroundColor: "#f7f8fc",
            backgroundImage:
              "radial-gradient(70% 50% at 0% 0%,#fde4ee 0%,transparent 60%),radial-gradient(60% 50% at 100% 0%,#dde8fd 0%,transparent 60%),radial-gradient(70% 55% at 100% 100%,#e2f4ea 0%,transparent 60%),radial-gradient(60% 50% at 0% 100%,#ece4fc 0%,transparent 60%)",
          }}
        >
          {isD ? (
            <>
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  gap: 24,
                  filter: "blur(9px)",
                  opacity: 0.8,
                  pointerEvents: "none",
                  transform: "scale(1.03)",
                }}
              >
                <div
                  style={{
                    width: 240,
                    flex: "none",
                    background: "#fff",
                    borderRight: "1px solid #e8eaed",
                    padding: "22px 16px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "0 8px 18px",
                    }}
                  >
                    <img
                      src={HF_ASSETS.experienceIcon}
                      alt=""
                      style={{ width: 20, height: "auto" }}
                    />
                    <span style={{ fontSize: 17, fontWeight: 700, color: "#12294d" }}>
                      experience<span style={{ color: "#1a73e8" }}>.com</span>
                    </span>
                  </div>
                  {FAKE_NAV.map((l, i) => (
                    <div
                      key={l}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        borderRadius: 10,
                        padding: "9px 10px",
                        fontSize: 14,
                        color: "#5f6368",
                        background: i === 0 ? "#e8f0fe" : "transparent",
                      }}
                    >
                      <span
                        style={{ width: 18, height: 18, borderRadius: 5, background: "#e8eaed" }}
                      />
                      {l}
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    flex: 1,
                    padding: 32,
                    display: "flex",
                    flexDirection: "column",
                    gap: 18,
                  }}
                >
                  <span style={{ fontSize: 24, fontWeight: 600 }}>{t("Morning, Alex")}</span>
                  <div style={{ display: "flex", gap: 16 }}>
                    <div style={{ flex: 2, height: 220, borderRadius: 20, background: "#fff" }} />
                    <div style={{ flex: 1, height: 220, borderRadius: 20, background: "#fff" }} />
                  </div>
                  <div style={{ display: "flex", gap: 12 }}>
                    <div style={{ flex: 1, height: 110, borderRadius: 16, background: "#fff" }} />
                    <div style={{ flex: 1, height: 110, borderRadius: 16, background: "#fff" }} />
                    <div style={{ flex: 1, height: 110, borderRadius: 16, background: "#fff" }} />
                  </div>
                </div>
              </div>
              <div style={{ position: "absolute", inset: 0, background: "rgba(24,30,48,.24)" }} />
            </>
          ) : null}

          <div
            style={{
              position: "relative",
              zIndex: 2,
              display: "flex",
              ...(isD
                ? {
                    flexDirection: "row",
                    width: 1120,
                    maxWidth: "calc(100% - 48px)",
                    height: "min(860px,calc(100% - 48px))",
                    margin: "auto",
                    borderRadius: 28,
                    overflow: "hidden",
                    background: "#fff",
                    boxShadow: "0 30px 80px rgba(20,28,48,.32),0 0 0 1px rgba(255,255,255,.7)",
                  }
                : { flexDirection: "column", flex: 1, minHeight: 0 }),
            }}
          >
            {isD ? (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: 0,
                  height: 3,
                  zIndex: 3,
                  background:
                    "linear-gradient(90deg,#4285f4 0%,#9b72f2 25%,#ea4335 50%,#fbbc04 75%,#34a853 100%)",
                  backgroundSize: "200% 100%",
                  animation: "hf-nDrift 10s ease infinite",
                }}
              />
            ) : null}

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                minWidth: 0,
                ...(isD
                  ? {
                      width: 480,
                      flex: "none",
                      borderRight: "1px solid #eceef1",
                      backgroundColor: "#fbfbfe",
                      backgroundImage:
                        "radial-gradient(80% 40% at 0% 0%,#fde4ee 0%,transparent 60%),radial-gradient(70% 40% at 100% 0%,#dde8fd 0%,transparent 60%),radial-gradient(80% 40% at 0% 100%,#ece4fc 0%,transparent 60%)",
                    }
                  : { flex: 1, minHeight: 0 }),
              }}
            >
              {isM ? (
                <div
                  style={{
                    flex: "none",
                    padding: "12px 14px 0",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      borderRadius: 22,
                      background: "rgba(255,255,255,.9)",
                      padding: "6px 6px 6px 14px",
                      boxShadow: "0 8px 24px rgba(66,133,244,.10)",
                    }}
                  >
                    <img
                      src={PERSONA.photo}
                      alt=""
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: "50%",
                        objectFit: "cover",
                        objectPosition: "50% 22%",
                        flex: "none",
                        boxShadow: "0 0 0 2px #fff,0 0 0 3px #e8eaed",
                      }}
                    />
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                      }}
                    >
                      <span style={{ fontSize: 15, fontWeight: 700 }}>{persona.name}</span>
                      <span
                        style={{
                          fontSize: 12,
                          color: "#5f6368",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        Senior Loan Officer · Demo Mortgage Co
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#1a73e8" }}>
                        Davenport, IA
                      </span>
                    </div>
                    {ring(96)}
                  </div>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 6, padding: "0 2px" }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        fontSize: 11,
                      }}
                    >
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontWeight: 700,
                          color: "#7b4ce0",
                        }}
                      >
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: "#9b72f2",
                            animation: "hf-pulseDot 1.6s ease-out infinite",
                          }}
                        />
                        Building your SRP
                      </span>
                      <span
                        style={{
                          fontWeight: 700,
                          color: "#202124",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {stripNote}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(4,minmax(0,1fr))",
                        gap: 4,
                      }}
                    >
                      {strip.map((s) => (
                        <div
                          key={s.label}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 5,
                            height: 26,
                            borderRadius: 8,
                            background: s.bg,
                            color: s.fg,
                            fontSize: 11,
                            fontWeight: 700,
                            transition: "background .4s,color .4s",
                            animation: s.anim,
                          }}
                        >
                          <Ic name={s.icon} size={12} sw={2.4} />
                          {s.label}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              <div
                style={{
                  flex: "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: isD ? "24px 24px 8px" : "10px 18px 2px",
                }}
              >
                <div
                  style={{
                    flex: 1,
                    display: "grid",
                    gridTemplateColumns: "repeat(4,minmax(0,1fr))",
                    gap: 8,
                  }}
                >
                  {phases.map((p) => (
                    <div
                      key={p.label}
                      style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}
                    >
                      <div style={{ display: "flex", gap: 2 }}>
                        {p.segs.map((bg, i) => (
                          <span
                            key={i}
                            style={{
                              flex: 1,
                              height: 4,
                              borderRadius: 2,
                              background: bg,
                              transition: "background .4s",
                            }}
                          />
                        ))}
                      </div>
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          fontSize: 11,
                          fontWeight: 700,
                          color: p.fg,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {p.dn ? <Tick size={10} color="#137333" /> : null}
                        {p.label}
                        {p.pts ? <span style={{ color: "#137333" }}>{p.pts}</span> : null}
                      </span>
                    </div>
                  ))}
                </div>
                {isD ? (
                  <button
                    type="button"
                    onClick={finishLater}
                    style={{
                      flex: "none",
                      border: 0,
                      background: "none",
                      padding: 0,
                      font: "700 13px Arial,sans-serif",
                      color: "#1a73e8",
                      cursor: "pointer",
                    }}
                  >
                    Finish later
                  </button>
                ) : null}
              </div>

              <div
                ref={eng.bodyRef}
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflow: "auto",
                  padding: isD ? "14px 24px 24px" : "12px 14px 18px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    transformOrigin: "top center",
                    transition: "opacity .26s ease,transform .26s ease",
                    opacity: st.leaving ? 0 : 1,
                    transform: st.leaving ? "translateY(-10px) scaleY(.94)" : "none",
                  }}
                >
                  {blocks}
                </div>

                {doneStack.length > 0 ? (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 7,
                      padding: "4px 6px",
                      borderTop: "1px solid rgba(26,115,232,.08)",
                      paddingTop: 12,
                    }}
                  >
                    {doneStack.map((d) => (
                      <div
                        key={d.t}
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "center",
                          fontSize: 13,
                          color: "#5f6368",
                          animation: "hf-rise .3s ease both",
                        }}
                      >
                        <span
                          style={{
                            width: 16,
                            height: 16,
                            flex: "none",
                            borderRadius: "50%",
                            background: "#34a853",
                            display: "grid",
                            placeItems: "center",
                          }}
                        >
                          <Tick size={9} />
                        </span>
                        <span style={{ flex: 1 }}>{d.t}</span>
                        {d.pts ? <b style={{ fontSize: 12, color: "#137333" }}>{d.pts}</b> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              {isM ? (
                <div
                  style={{
                    flex: "none",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 18px 14px",
                    fontSize: 12,
                    color: "#80868b",
                  }}
                >
                  <span>Set up with NORA · step 3 of 3</span>
                  <button
                    type="button"
                    onClick={finishLater}
                    style={{
                      border: 0,
                      background: "none",
                      padding: 0,
                      font: "700 13px Arial,sans-serif",
                      color: "#1a73e8",
                      cursor: "pointer",
                    }}
                  >
                    Finish later
                  </button>
                </div>
              ) : null}
            </div>

            {isD ? (
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  background: "#f3f5fa",
                }}
              >
                <div
                  style={{
                    flex: "none",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "22px 26px 0",
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: liveDot,
                      animation: "hf-pulseDot 1.6s ease-out infinite",
                    }}
                  />
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: ".14em",
                      color: "#5f6368",
                    }}
                  >
                    {paneLabel}
                  </span>
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#1a73e8",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {factsNow} facts
                  </span>
                </div>
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    overflow: "auto",
                    padding: "14px 26px 26px",
                    display: "grid",
                    gridTemplateColumns: "repeat(2,minmax(0,1fr))",
                    gap: 12,
                    alignContent: "start",
                  }}
                >
                  <div
                    style={{
                      gridColumn: "1 / -1",
                      display: "flex",
                      alignItems: "center",
                      gap: 16,
                      borderRadius: 22,
                      background: "#fff",
                      padding: "14px 14px 14px 20px",
                      boxShadow: "0 8px 24px rgba(66,133,244,.08)",
                    }}
                  >
                    <img
                      src={PERSONA.photo}
                      alt=""
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: "50%",
                        objectFit: "cover",
                        objectPosition: "50% 22%",
                        flex: "none",
                        boxShadow: "0 0 0 3px #fff,0 0 0 4px #e8eaed",
                      }}
                    />
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: 3,
                      }}
                    >
                      <span style={{ fontSize: 19, fontWeight: 700 }}>{persona.name}</span>
                      <span style={{ fontSize: 13, color: "#5f6368" }}>
                        Senior Loan Officer · Demo Mortgage Co
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#1a73e8" }}>
                        Davenport, IA
                      </span>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                        {st.nmls ? (
                          <span
                            style={{
                              borderRadius: 8,
                              background: "#e6f4ea",
                              padding: "2px 8px",
                              fontSize: 11,
                              fontWeight: 700,
                              color: "#137333",
                              animation: "hf-pop .4s ease both",
                            }}
                          >
                            NMLS 482913 · confirmed by you
                          </span>
                        ) : null}
                        {c === 9 ? (
                          <span
                            style={{
                              borderRadius: 8,
                              background: "#34a853",
                              padding: "2px 8px",
                              fontSize: 11,
                              fontWeight: 700,
                              color: "#fff",
                              animation: "hf-pop .4s ease both",
                            }}
                          >
                            Live
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {ring(140)}
                  </div>
                  {showFound ? (
                    <div
                      style={{
                        gridColumn: "1 / -1",
                        borderRadius: 18,
                        background: "#fff",
                        padding: "14px 16px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                        animation: "hf-rise .35s ease both",
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 700 }}>Found so far</span>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {paneFound.map((f, i) => (
                          <span
                            key={i}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              height: 28,
                              borderRadius: 999,
                              background: f.bg,
                              padding: "0 10px",
                              fontSize: 12,
                              fontWeight: 600,
                              color: f.fg,
                              textDecoration: f.td,
                              animation: "hf-pop .4s ease both",
                            }}
                          >
                            <span
                              style={{
                                width: 7,
                                height: 7,
                                borderRadius: "50%",
                                background: f.color,
                              }}
                            />
                            {f.n}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {pClusters.map((x) => (
                    <div
                      key={x.label}
                      style={{
                        gridColumn: x.span,
                        borderRadius: 18,
                        background: "#fff",
                        padding: "14px 16px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 7,
                        border: x.bd,
                        boxShadow: x.sh,
                        transition: "border-color .4s,box-shadow .4s",
                        animation: "hf-land .6s ease both",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span
                          style={{ width: 8, height: 8, borderRadius: "50%", background: x.color }}
                        />
                        <span style={{ fontSize: 13, fontWeight: 700 }}>{x.label}</span>
                        <span
                          style={{
                            marginLeft: "auto",
                            fontSize: 11,
                            color: "#80868b",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {x.n} facts
                        </span>
                      </div>
                      {x.rows.map((r) => (
                        <span key={r} style={{ fontSize: 13, lineHeight: 1.35, color: "#202124" }}>
                          {r}
                        </span>
                      ))}
                      {x.badge ? (
                        <span
                          style={{
                            alignSelf: "flex-start",
                            borderRadius: 8,
                            padding: "2px 8px",
                            fontSize: 11,
                            fontWeight: 700,
                            background: x.bbg,
                            color: x.bfg,
                          }}
                        >
                          {x.badge}
                        </span>
                      ) : null}
                    </div>
                  ))}
                  {mapOn ? (
                    <div
                      style={{
                        gridColumn: "1 / -1",
                        display: "flex",
                        alignItems: "center",
                        gap: 18,
                        borderRadius: 18,
                        background: "#fff",
                        padding: "14px 16px",
                        border: c === 7 ? "1.5px solid #a8c7fa" : "1.5px solid transparent",
                        boxShadow:
                          c === 7
                            ? "0 0 0 4px rgba(66,133,244,.10)"
                            : "0 2px 8px rgba(60,64,67,.04)",
                        animation: "hf-land .6s ease both",
                      }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(7,16px)",
                          gap: 3,
                          flex: "none",
                        }}
                      >
                        {GRID.map((x) => (
                          <span
                            key={x.i}
                            style={{
                              width: 16,
                              height: 16,
                              borderRadius: 4,
                              background: x.bg,
                              opacity: x.ring <= ringRev ? 1 : 0.07,
                              transition: "opacity .35s",
                            }}
                          />
                        ))}
                      </div>
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            fontSize: 13,
                            fontWeight: 700,
                          }}
                        >
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: "#ea4335",
                            }}
                          />
                          Map · 49 spots around 100 Main St
                        </span>
                        <span
                          style={{
                            fontSize: 28,
                            fontWeight: 700,
                            letterSpacing: "-0.02em",
                            lineHeight: 1,
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          9{" "}
                          <span
                            style={{
                              fontSize: 13,
                              fontWeight: 400,
                              color: "#5f6368",
                              letterSpacing: 0,
                            }}
                          >
                            of 49 in the top 3
                          </span>
                        </span>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          <span
                            style={{
                              borderRadius: 8,
                              background: "#fce8e6",
                              padding: "2px 8px",
                              fontSize: 11,
                              fontWeight: 700,
                              color: "#c5221f",
                            }}
                          >
                            Riverbend Bank &amp; Trust · 34 of 49
                          </span>
                          <span
                            style={{
                              borderRadius: 8,
                              background: "#f1f3f4",
                              padding: "2px 8px",
                              fontSize: 11,
                              fontWeight: 700,
                              color: "#5f6368",
                            }}
                          >
                            5 competitors mapped
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          {st.toastMsg ? (
            <div
              role="status"
              style={{
                position: "absolute",
                left: "50%",
                bottom: 24,
                transform: "translateX(-50%)",
                zIndex: 60,
                borderRadius: 12,
                background: "#202124",
                padding: "10px 16px",
                fontSize: 13,
                color: "#fff",
                boxShadow: "0 4px 12px rgba(0,0,0,.2)",
                whiteSpace: "nowrap",
              }}
            >
              {st.toastMsg}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
