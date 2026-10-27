/**
 * Screen 9 · Website Analytics — audits Alex's own page and turns each failure into a fix
 * NORA can hand to her webmaster. Ported 1:1 from the Happyflow prototype (SRP App, `sWeb`).
 */
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { usePersonalize, useHfPersona } from "../persona-context";
import { HappyflowShell, useHf, type Think } from "../shell";
import { HealthGauge, Hov, Ic, NoraFace } from "../primitives";
import type { HfIconName } from "../icons";

// Demo data (Happyflow prototype)

const SENT_TOAST = "Sent to your webmaster with the code attached";

const THINKS: Think[] = [
  {
    t: "Markup is worth 42 points.",
    d: "I've written the code — your webmaster only needs to paste it in.",
    cta: "Send to my webmaster",
    act: (api) => {
      api.closeNora();
      api.toast(SENT_TOAST);
    },
  },
  {
    t: "AI can't read your page yet.",
    d: "GPTBot is blocked in robots.txt, and there's no llms.txt or FAQ.",
    cta: "See the checks",
    act: "close",
  },
];

type CheckState = "fail" | "warn" | "pass";

/** [group, result, points, state] */
const CHK: [string, string, string, CheckState][] = [
  ["Entity and markup", "No structured data on the page", "+42 open", "fail"],
  ["Name, address, phone", "Matches the profile", "30 of 30", "pass"],
  ["Indexing", "Indexed; no sitemap", "10 of 20", "warn"],
  ["Service pages", "No pages for FHA or VA loans", "0 of 10", "fail"],
  ["Speed", "LCP 3.1 s (needs work), INP 180 ms, CLS 0.02", "—", "warn"],
  [
    "AI readiness",
    "GPTBot blocked in robots.txt; no llms.txt; no FAQ; content in the page HTML",
    "—",
    "warn",
  ],
  ["Content", "No blog", "—", "fail"],
  ["Conversion", "Click-to-call yes; no booking link", "—", "warn"],
  ["Reviews on site", "Widget not installed", "—", "fail"],
  ["Security", "HTTPS", "Pass", "pass"],
];

/** Checks filter: same pills as the SRS gap list. */
const CHECK_FILTERS: { key: "all" | CheckState; label: string }[] = [
  { key: "all", label: "All" },
  { key: "fail", label: "Failing" },
  { key: "warn", label: "Needs work" },
  { key: "pass", label: "Passing" },
];

const SC: Record<CheckState, [string, string, HfIconName]> = {
  fail: ["#fce8e6", "#c5221f", "x"],
  warn: ["#fef7e0", "#b06000", "alert"],
  pass: ["#e6f4ea", "#137333", "check"],
};

/** [icon, label, value, note, bg, fg, check it opens] */
const TILES: [HfIconName, string, string, string, string, string, string][] = [
  ["zap", "Speed", "LCP 3.1 s", "Needs work", "#fef7e0", "#b06000", "Speed"],
  ["code", "Markup", "Missing", "+42 open", "#fce8e6", "#c5221f", "Entity and markup"],
  ["spark", "AI readiness", "2 of 5", "Needs work", "#fef7e0", "#b06000", "AI readiness"],
];

/** Webmaster hand-off steps (demo): sent now, opened shortly after, then NORA re-checks the page nightly. */
const HANDOFF = ["Sent", "Opened by webmaster", "Installed", "Verified on your page"];

const CODE_SAMPLE = `<script type="application/ld+json">
{ "@type": "FinancialService",
  "name": "Alex Sample – Demo Mortgage",
  "telephone": "(563) 555-0100",
  "address": "100 Main St, Davenport, IA 52801" }
</script>`;

const PEARL_BG =
  "radial-gradient(120% 90% at 0% 0%,oklch(0.965 0.021 30) 0%,transparent 55%),radial-gradient(110% 90% at 100% 0%,oklch(0.955 0.025 285) 0%,transparent 55%),linear-gradient(180deg,oklch(0.985 0.004 285),#fff)";

/** Site re-check (demo): steps through the audit with a progress bar. Nothing is fetched. */
const SCAN_STEPS = [
  "Fetching your page",
  "Checking markup",
  "Measuring speed",
  "Checking AI readiness",
  "Comparing with the last scan",
];
type Scan = { pct: number; running: boolean; last: string; start: () => void };
const ScanCtx = createContext<Scan | null>(null);
const useScan = () => {
  const v = useContext(ScanCtx);
  if (!v) throw new Error("useScan must be used inside WebsiteScreen");
  return v;
};

export function WebsiteScreen() {
  const persona = useHfPersona();
  const [pct, setPct] = useState(0);
  const [running, setRunning] = useState(false);
  const [last, setLast] = useState("Oct 16");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );
  const start = () => {
    if (running) return;
    setPct(0);
    setRunning(true);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => {
      setPct((p) => {
        const next = Math.min(100, p + 4);
        if (next >= 100 && timer.current) {
          clearInterval(timer.current);
          timer.current = null;
          setRunning(false);
          setLast("just now");
        }
        return next;
      });
    }, 160);
  };
  return (
    <ScanCtx.Provider value={{ pct, running, last, start }}>
      <HappyflowShell
        screen="website"
        day={1}
        title="Website Analytics"
        sub={persona.site}
        nora={{ thinks: THINKS }}
        headerRight={<RecheckButton />}
      >
        <WebsiteBody />
      </HappyflowShell>
    </ScanCtx.Provider>
  );
}

function RecheckButton() {
  const { running, start } = useScan();
  return (
    <Hov
      onClick={start}
      aria-label={running ? "Re-checking your site" : "Re-check your site"}
      disabled={running}
      style={{
        flex: "none",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        height: 40,
        border: "1px solid #d2e3fc",
        borderRadius: 999,
        background: "#fff",
        padding: "0 14px 0 12px",
        font: "700 13px Arial,sans-serif",
        color: "#1a73e8",
        cursor: running ? "default" : "pointer",
        whiteSpace: "nowrap",
      }}
      hover={running ? undefined : { background: "#f5f9ff" }}
    >
      <span
        style={{
          display: "flex",
          animation: running ? "hf-nSpin 1s linear infinite" : "none",
        }}
      >
        <Ic name="refresh" size={16} color="#1a73e8" />
      </span>
      {running ? "Re-checking…" : "Re-check"}
    </Hov>
  );
}

/** Progress of the current re-check, then "Last checked" once it is done. */
function ScanStatus() {
  const { pct, running, last } = useScan();
  const step = Math.min(SCAN_STEPS.length - 1, Math.floor((pct / 100) * SCAN_STEPS.length));
  return (
    <div
      role="status"
      aria-label="Site re-check progress"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        borderRadius: 16,
        background: "#fff",
        border: `1px solid ${running ? "#d2e3fc" : "#e8eaed"}`,
        padding: "12px 14px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
        <b style={{ flex: 1 }}>
          {running ? SCAN_STEPS[step] + "…" : pct === 100 ? "Re-check complete" : "Site scan"}
        </b>
        <span style={{ color: "#5f6368", fontVariantNumeric: "tabular-nums" }}>
          {running ? `${pct}%` : `Last checked ${last}`}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: "#e8f0fe", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${running || pct === 100 ? pct : 100}%`,
            borderRadius: 3,
            background: running ? "#1a73e8" : "#34a853",
            transition: "width .16s linear",
          }}
        />
      </div>
      {pct === 100 && !running ? (
        <span style={{ fontSize: 12, color: "#137333" }}>
          No changes since the last scan — the checks below are current.
        </span>
      ) : null}
    </div>
  );
}

function WebsiteBody() {
  const t = usePersonalize();
  const CODE = t(CODE_SAMPLE);
  const hf = useHf();
  const { isD, w } = hf;
  const wide = isD && w >= 1300;
  const [sent, setSent] = useState(false);
  const [handoff, setHandoff] = useState(0);
  const checksRef = useRef<HTMLElement>(null);
  const [checkFilter, setCheckFilter] = useState<"all" | CheckState>("all");

  // Demo progression: the webmaster opens the hand-off a few seconds after it is sent.
  useEffect(() => {
    if (handoff !== 1) return;
    const t = setTimeout(() => setHandoff(2), 2500);
    return () => clearTimeout(t);
  }, [handoff]);

  const openCheck = (g: string) => {
    const c = CHK.find((x) => x[0] === g);
    if (!c) return;
    const pass = c[3] === "pass";
    hf.openSheet({
      title: c[0],
      body: c[1],
      cta: pass ? "Got it" : "Send the fix to my webmaster",
      nora: pass
        ? "Nothing to fix here."
        : "I'll write the fix and hand it to your webmaster with clear steps.",
      done: pass ? undefined : "Sent to your webmaster",
    });
  };

  const send = () => {
    setSent(true);
    setHandoff((h) => Math.max(h, 1));
    hf.toast(SENT_TOAST);
  };

  return (
    <>
      <ScanStatus />
      <div
        style={{
          display: "grid",
          gap: 14,
          gridTemplateColumns: wide
            ? "minmax(0,1.2fr) repeat(3,minmax(0,1fr))"
            : "repeat(2,minmax(0,1fr))",
        }}
      >
        <Hov
          as="section"
          role="button"
          tabIndex={0}
          aria-label="Site health 40 of 102 — see the checks"
          onClick={() => checksRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
          style={{
            cursor: "pointer",
            borderRadius: 24,
            backgroundImage: PEARL_BG,
            padding: 18,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            boxShadow: "0 12px 32px rgba(66,133,244,.12)",
            animation: "hf-rise .32s ease both",
          }}
        >
          <HealthGauge px={isD ? 170 : 150} />
          <span style={{ fontSize: 13, fontWeight: 700 }}>Site health</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#1a73e8" }}>See the checks →</span>
        </Hov>
        {TILES.map(([icon, l, v, n, bg, fg, check], k) => (
          <Hov
            as="section"
            role="button"
            tabIndex={0}
            key={l}
            aria-label={`${l}: ${v} — open the check`}
            onClick={() => openCheck(check)}
            hover={{ boxShadow: "0 8px 20px rgba(66,133,244,.16)" }}
            style={{
              cursor: "pointer",
              borderRadius: 22,
              background: "rgba(255,255,255,.95)",
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              boxShadow: "0 4px 12px rgba(66,133,244,.08)",
              animation: `hf-rise .32s ease ${60 + k * 50}ms both`,
            }}
          >
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                fontWeight: 700,
                color: "#5f6368",
                whiteSpace: "nowrap",
              }}
            >
              <Ic name={icon} size={15} color={fg} />
              {l}
            </span>
            <span
              style={{
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: "-0.02em",
                lineHeight: 1.05,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {v}
            </span>
            <span
              style={{
                alignSelf: "flex-start",
                borderRadius: 999,
                background: bg,
                padding: "3px 10px",
                fontSize: 12,
                fontWeight: 700,
                color: fg,
                whiteSpace: "nowrap",
              }}
            >
              {n}
            </span>
          </Hov>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gap: 16,
          alignItems: "start",
          gridTemplateColumns: wide ? "minmax(0,1fr) 380px" : "minmax(0,1fr)",
        }}
      >
        <section
          ref={checksRef}
          style={{
            scrollMarginTop: 16,
            borderRadius: 24,
            background: "rgba(255,255,255,.95)",
            padding: isD ? "18px" : "12px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            boxShadow: "0 4px 12px rgba(66,133,244,.08)",
            animation: "hf-rise .32s ease .1s both",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 8,
              padding: "2px 4px 6px",
            }}
          >
            <span style={{ fontSize: 17, fontWeight: 700 }}>Checks</span>
            <span style={{ fontSize: 12, color: "#80868b" }}>Tap one to see the fix</span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
              {CHECK_FILTERS.map((fl) => {
                const on = checkFilter === fl.key;
                const n = fl.key === "all" ? CHK.length : CHK.filter((c) => c[3] === fl.key).length;
                return (
                  <button
                    key={fl.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setCheckFilter(fl.key)}
                    style={{
                      height: 32,
                      border: `1px solid ${on ? "#1a73e8" : "#e3e5e8"}`,
                      borderRadius: 999,
                      background: on ? "#e8f0fe" : "#fff",
                      padding: "0 12px",
                      font: "700 12px Arial,sans-serif",
                      color: on ? "#1967d2" : "#3c4043",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {fl.label} <span style={{ color: on ? "#1967d2" : "#9aa0a6" }}>{n}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {CHK.filter((c) => checkFilter === "all" || c[3] === checkFilter).map(
            ([g, r, p, s], i) => {
              const [dBg, fg, ic] = SC[s];
              const pass = s === "pass";
              return (
                <Hov
                  key={g}
                  onClick={() => openCheck(g)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    border: 0,
                    borderRadius: 14,
                    background: i % 2 ? "transparent" : "#fafbfd",
                    padding: 12,
                    textAlign: "left",
                    cursor: "pointer",
                    font: "14px Arial,sans-serif",
                    color: "#202124",
                  }}
                  hover={{ background: "#f5f9ff" }}
                >
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      flex: "none",
                      borderRadius: "50%",
                      background: dBg,
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    <Ic name={ic} size={14} color={fg} sw={2.6} />
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
                    <b style={{ fontSize: 14 }}>{g}</b>
                    <span style={{ fontSize: 13, lineHeight: 1.4, color: "#5f6368" }}>{r}</span>
                  </div>
                  <span
                    style={{
                      flex: "none",
                      fontSize: 13,
                      fontWeight: 700,
                      color: pass ? "#137333" : s === "fail" ? "#c5221f" : "#3c4043",
                      whiteSpace: "nowrap",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {p}
                  </span>
                </Hov>
              );
            },
          )}
        </section>

        <section
          style={{
            order: wide ? 0 : -1,
            position: wide ? "sticky" : "relative",
            top: 0,
            borderRadius: 24,
            background: "#eef3fe",
            border: "1.5px solid #d2e3fc",
            padding: 18,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            animation: "hf-rise .32s ease .16s both",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <NoraFace size={40} />
            <span
              style={{
                borderRadius: 999,
                background: "linear-gradient(135deg,#4285f4,#9b72f2)",
                padding: "3px 10px",
                fontSize: 11,
                fontWeight: 700,
                color: "#fff",
              }}
            >
              Top fix · +42 points
            </span>
          </div>
          <span style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.35 }}>
            Add markup so Google and AI can read your page.
          </span>
          <span style={{ fontSize: 14, color: "#3c4043" }}>I&apos;ve written the code.</span>
          <pre
            style={{
              margin: 0,
              borderRadius: 14,
              background: "#202124",
              padding: "12px 14px",
              font: "12px/1.55 ui-monospace,Menlo,monospace",
              color: "#e8eaed",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {CODE}
          </pre>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Hov
              onClick={send}
              style={{
                flex: "1 1 160px",
                height: 44,
                border: 0,
                borderRadius: 12,
                background: "#1a73e8",
                font: "700 14px Arial,sans-serif",
                color: "#fff",
                cursor: "pointer",
              }}
              hover={{ background: "#1557b0" }}
            >
              {sent ? "Sent ✓" : "Send to my webmaster"}
            </Hov>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(CODE).catch(() => undefined);
                hf.toast("Code copied");
              }}
              style={{
                flex: "1 1 110px",
                height: 44,
                border: "1px solid #d2e3fc",
                borderRadius: 12,
                background: "#fff",
                font: "700 14px Arial,sans-serif",
                color: "#1a73e8",
                cursor: "pointer",
              }}
            >
              Copy code
            </button>
          </div>
          {handoff > 0 ? (
            <HandoffTracker
              step={handoff}
              onCheck={() =>
                hf.toast("Not live yet — I'll check again tonight and tell you when it is")
              }
            />
          ) : null}
        </section>
      </div>
    </>
  );
}

function HandoffTracker({ step, onCheck }: { step: number; onCheck: () => void }) {
  const pct = ((step / HANDOFF.length) * 100).toFixed(0) + "%";
  return (
    <div
      role="status"
      aria-label="Webmaster hand-off progress"
      style={{
        borderRadius: 16,
        background: "#fff",
        border: "1px solid #d2e3fc",
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        animation: "hf-rise .3s ease both",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <b style={{ flex: 1, fontSize: 13 }}>Webmaster hand-off</b>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#1967d2" }}>
          {step} of {HANDOFF.length}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: "#e8f0fe", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: pct,
            borderRadius: 3,
            background: "#1a73e8",
            transition: "width .6s ease",
          }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {HANDOFF.map((l, i) => {
          const done = i < step;
          return (
            <span
              key={l}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                color: done ? "#202124" : "#9aa0a6",
              }}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  flex: "none",
                  borderRadius: "50%",
                  background: done ? "#34a853" : "#f1f3f4",
                  display: "grid",
                  placeItems: "center",
                }}
              >
                {done ? <Ic name="check" size={10} color="#fff" sw={3.5} /> : null}
              </span>
              {l}
              {i === step ? (
                <span style={{ marginLeft: "auto", fontSize: 11, color: "#80868b" }}>
                  {i === 1 ? "Waiting" : "I check nightly"}
                </span>
              ) : null}
            </span>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onCheck}
        style={{
          alignSelf: "flex-start",
          border: 0,
          background: "none",
          padding: 0,
          font: "700 13px Arial,sans-serif",
          color: "#1a73e8",
          cursor: "pointer",
        }}
      >
        Check now
      </button>
    </div>
  );
}
