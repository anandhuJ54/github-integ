/**
 * Screen 6 · Search Rank Score. Ported 1:1 from the Happyflow prototype (SRS.dc.html):
 * score ring + band bar, the #1 target race, NORA's note, the 11-lane gap list and the
 * "How your score is calculated" dialog.
 */
import { useEffect, useState, type CSSProperties } from "react";
import {
  HappyflowShell,
  CloseBtn,
  useHf,
  type HfApi,
  type HfTarget,
  type Think,
  HF_NORA_UI,
} from "../shell";
import { Hov, Ic, NoraFace, PEARL, ScoreRing, prefersReducedMotion } from "../primitives";
import type { HfIconName } from "../icons";

import { LANES, type Lane, type LaneStatus } from "../sample-srs";
import { useSrsModel } from "../srs-context";
import {
  pointsText,
  type LaneTo,
  type ModelLane,
  type SrsFilter,
  type SrsModel,
} from "@v3/srp/utils/srs-model";

export { LANES };
export type { Lane };

/** Status → [pill / icon background, pill / icon foreground, bar colour]. */
const ST: Record<LaneStatus, [string, string, string]> = {
  Missing: ["#fce8e6", "#c5221f", "#ea4335"],
  Fix: ["#e8f0fe", "#1967d2", "#4285f4"],
  "Fix · locked": ["#fef7e0", "#b06000", "#fbbc04"],
  Strong: ["#e6f4ea", "#137333", "#34a853"],
};

type Filter = SrsFilter;
const FILTERS: Filter[] = ["All", "Missing", "Fix", "Strong"];
const groupOf = (s: LaneStatus): Exclude<Filter, "All"> =>
  s.startsWith("Fix") ? "Fix" : (s as "Missing" | "Strong");

const FACE_SHADOW = "0 6px 18px rgba(155,114,242,.35)";
const TABLE_COLS = "minmax(140px,1fr) minmax(96px,auto) minmax(170px,1fr) minmax(200px,2fr) auto";

const laneGo = (hf: HfApi, to: LaneTo) => (to === "Billing" ? hf.out("Billing") : hf.run(to));

/** NORA's panel for the page: her notes as the thinks (a Billing note opens Billing), her chips, and the opening line. */
export function noraFor(model: SrsModel) {
  const g = model.copy.greeting;
  return {
    status: "Looking at your SRS with you",
    greeting: (
      <>
        {g.before}
        <b>{g.bold}</b>
        {g.after}
      </>
    ),
    thinks: model.notes.map<Think>((n) => ({
      t: n.t,
      d: n.d,
      cta: n.cta,
      act: n.to === "Billing" ? (api: HfApi) => api.out("Billing") : n.to,
    })),
    chips: model.copy.chips,
    launcherText: "Ask NORA about your score",
    noUses: true,
  };
}

export function SrsScreen() {
  const model = useSrsModel();
  const [calc, setCalc] = useState(false);
  return (
    <HappyflowShell
      screen="srs"
      day={1}
      title="Search Rank Score"
      sub={model.copy.subtitle}
      headerRight={<CalcButton onOpen={() => setCalc(true)} />}
      nora={noraFor(model)}
      overlay={(api) =>
        calc ? <CalcDialog isD={api.isD} onClose={() => setCalc(false)} model={model} /> : null
      }
    >
      <SrsBody model={model} />
    </HappyflowShell>
  );
}

function CalcButton({ onOpen }: { onOpen: () => void }) {
  const { isD } = useHf();
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        flex: "none",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 38,
        border: "1px solid #d2e3fc",
        borderRadius: 999,
        background: "#fff",
        padding: "0 14px",
        font: "700 13px Arial,sans-serif",
        color: "#1a73e8",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      <Ic name="info" size={15} />
      {isD ? "How it's calculated" : "How?"}
    </button>
  );
}

/** Counts the score up from 0 (ease-out cubic, 1 s, after 150 ms), like the prototype. */
function useCountUp(target: number) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion()) {
      setV(target);
      return;
    }
    const t0 = performance.now() + 150;
    const d = 1000;
    let raf = 0;
    const step = (now: number) => {
      const p = Math.max(0, Math.min(1, (now - t0) / d));
      const e = 1 - Math.pow(1 - p, 3);
      setV(Math.round(target * e));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return v;
}

/** The gap list as drawn: the model's lanes for a filter, with their colours, bar width and action colours (the first row is the highlighted one). */
export function srsRows(model: SrsModel, filter: Filter) {
  return model.lanes
    .filter((l) => filter === "All" || groupOf(l.status) === filter)
    .map((l: ModelLane, i) => {
      const [pb, pf, bar] = ST[l.status];
      const locked = l.status.includes("locked");
      const strong = l.status === "Strong";
      return {
        ...l,
        statusShort: locked ? "Locked" : l.status,
        delay: `${i * 35}ms`,
        pb,
        pf,
        bar,
        locked,
        earned: l.max - l.pts,
        barW: (((l.max - l.pts) / l.max) * 100).toFixed(1) + "%",
        rowBg: i % 2 ? "transparent" : "#fafbfd",
        actBg: i === 0 ? "#1a73e8" : locked ? "#fef7e0" : strong ? "#f1f3f4" : "#e8f0fe",
        actFg: i === 0 ? "#fff" : locked ? "#b06000" : strong ? "#3c4043" : "#1967d2",
      };
    });
}

function SrsBody({ model }: { model: SrsModel }) {
  const hf = useHf();
  const { isD, w } = hf;
  const wide = isD && w >= 1320;
  const tableOn = isD && w >= 1240;
  const score = useCountUp(model.score.total);
  const { rival, rank, bar, callout } = model;
  const [filter, setFilter] = useState<Filter>("All");

  const cardPad = isD ? 24 : 18;
  const gaugeAlign = wide ? "flex-start" : "center";

  const rows = srsRows(model, filter);

  const raceRow: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "72px minmax(0,1fr) 44px",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
  };
  const btnBase: CSSProperties = { border: 0, cursor: "pointer" };

  return (
    <>
      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: isD ? "minmax(0,1fr) minmax(0,1fr)" : "minmax(0,1fr)",
        }}
      >
        <section
          style={{
            position: "relative",
            overflow: "hidden",
            borderRadius: 24,
            backgroundImage: PEARL,
            padding: cardPad,
            display: "flex",
            flexDirection: wide ? "row" : "column",
            alignItems: "center",
            gap: 22,
            boxShadow: "0 12px 32px rgba(66,133,244,.12)",
            animation: "hf-rise .32s ease both",
          }}
        >
          <ScoreRing
            px={wide ? 190 : isD ? 170 : 180}
            ns={42}
            value={score}
            label={model.score.max ? `/ ${model.score.max}` : ""}
            id="srsG"
          />
          <div
            style={{
              flex: wide ? "1 1 220px" : "0 0 auto",
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              alignItems: gaugeAlign,
              textAlign: wide ? "left" : "center",
            }}
          >
            <span
              style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".12em", color: "#80868b" }}
            >
              {model.score.max ? `YOUR SCORE · OF ${model.score.max}` : "YOUR SCORE"}
            </span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: gaugeAlign }}>
              {model.score.band ? (
                <span
                  style={{
                    borderRadius: 999,
                    background: "#fef7e0",
                    padding: "5px 12px",
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#b06000",
                  }}
                >
                  {model.score.band}
                </span>
              ) : null}
              {model.score.nextBand ? (
                <span
                  style={{
                    borderRadius: 999,
                    background: "#e6f4ea",
                    padding: "5px 12px",
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#137333",
                  }}
                >
                  {pointsText(model.score.nextBand.pointsNeeded)} to {model.score.nextBand.name}
                </span>
              ) : null}
            </div>
            {rank ? (
              <span style={{ fontSize: 15, color: "#202124" }}>
                <b>
                  #{rank.position} of {rank.of}
                </b>{" "}
                in {rank.city ?? "your market"}
              </span>
            ) : null}
            <div
              style={{
                width: "100%",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                maxWidth: 320,
                minWidth: 200,
              }}
            >
              <div
                style={{ position: "relative", height: 8, borderRadius: 4, background: "#eceef1" }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: `${bar.fillPct}%`,
                    borderRadius: 4,
                    background: "linear-gradient(90deg,#4285f4,#9b72f2)",
                  }}
                />
                {bar.markerPct !== null ? (
                  <span
                    style={{
                      position: "absolute",
                      left: `${bar.markerPct}%`,
                      top: -4,
                      bottom: -4,
                      width: 2,
                      borderRadius: 1,
                      background: "#137333",
                    }}
                  />
                ) : null}
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 11,
                  color: "#80868b",
                }}
              >
                <span>{bar.from}</span>
                {bar.next ? (
                  <span style={{ color: "#137333", fontWeight: 700 }}>{bar.next}</span>
                ) : null}
                <span>{bar.end}</span>
              </div>
            </div>
          </div>
        </section>

        <section
          style={{
            borderRadius: 24,
            background: "rgba(255,255,255,.95)",
            padding: cardPad,
            display: "flex",
            flexDirection: "column",
            gap: 14,
            boxShadow: "0 4px 12px rgba(66,133,244,.08)",
            animation: "hf-rise .32s ease .06s both",
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: ".12em",
              color: "#c5221f",
            }}
          >
            <Ic name="target" size={14} color="#c5221f" sw={2.4} />
            YOUR TARGET
          </span>
          {rival ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span
                  style={{
                    width: 44,
                    height: 44,
                    flex: "none",
                    borderRadius: "50%",
                    background: "#fce8e6",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 17,
                    fontWeight: 700,
                    color: "#c5221f",
                  }}
                >
                  {rival.initial}
                </span>
                <div
                  style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}
                >
                  <span style={{ fontSize: 17, fontWeight: 700 }}>
                    {rival.name}: {rival.score}
                  </span>
                  <span style={{ fontSize: 13, color: "#5f6368" }}>
                    {[
                      `#1 in ${model.city ?? "your market"}`,
                      rival.reviewAvg !== null && rival.reviewCount !== null
                        ? `${rival.reviewAvg} from ${rival.reviewCount} reviews`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={raceRow}>
                  <span style={{ fontWeight: 700 }}>You</span>
                  <div
                    style={{
                      height: 12,
                      borderRadius: 6,
                      background: "#eceef1",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${model.race.youPct}%`,
                        height: "100%",
                        borderRadius: 6,
                        background: "linear-gradient(90deg,#4285f4,#9b72f2)",
                        transformOrigin: "left",
                        animation: "hf-grow .9s cubic-bezier(.2,.8,.2,1) both",
                      }}
                    />
                  </div>
                  <b
                    style={{
                      textAlign: "right",
                      color: "#1a73e8",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {score}
                  </b>
                </div>
                <div style={raceRow}>
                  <span style={{ fontWeight: 700 }}>{rival.short}</span>
                  <div
                    style={{
                      height: 12,
                      borderRadius: 6,
                      background: "#eceef1",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: "100%",
                        height: "100%",
                        borderRadius: 6,
                        background: "#ea4335",
                        transformOrigin: "left",
                        animation: "hf-grow .9s cubic-bezier(.2,.8,.2,1) .1s both",
                      }}
                    />
                  </div>
                  <b style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {rival.score}
                  </b>
                </div>
              </div>
            </>
          ) : (
            <span style={{ fontSize: 17, fontWeight: 700 }}>
              You're ahead of every competitor we track in {model.city ?? "your market"}.
            </span>
          )}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2,minmax(0,1fr))",
              gap: 10,
              marginTop: 2,
            }}
          >
            {rival ? (
              <div
                style={{
                  borderRadius: 16,
                  background: "#fce8e6",
                  padding: "12px 14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <span
                  style={{
                    fontSize: 28,
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                    lineHeight: 1,
                    color: "#c5221f",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {rival.pointsToFirst}
                </span>
                <span style={{ fontSize: 12, color: "#5f6368" }}>points to #1</span>
              </div>
            ) : null}
            <div
              style={{
                borderRadius: 16,
                background: "#e8f0fe",
                padding: "12px 14px",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <span
                style={{
                  fontSize: 28,
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  lineHeight: 1,
                  color: "#1967d2",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {model.score.openTotal ?? ""}
              </span>
              <span style={{ fontSize: 12, color: "#5f6368" }}>
                points open across {model.counts.All} lanes
              </span>
            </div>
          </div>
        </section>
      </div>

      {callout ? (
        <section
          style={{
            display: "flex",
            gap: 12,
            alignItems: "flex-start",
            borderRadius: 20,
            background: "#eef3fe",
            border: "1.5px solid #d2e3fc",
            padding: "14px 16px",
            animation: "hf-rise .32s ease .1s both",
          }}
        >
          <NoraFace size={40} shadow={FACE_SHADOW} />
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 15, lineHeight: 1.5 }}>
              <b>{callout.title}</b> {callout.text}
            </span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <Hov
                onClick={() => (callout.to === "Billing" ? hf.out("Billing") : hf.go(callout.to))}
                style={{
                  ...btnBase,
                  height: 38,
                  borderRadius: 12,
                  background: "#1a73e8",
                  padding: "0 16px",
                  font: "700 13px Arial,sans-serif",
                  color: "#fff",
                }}
                hover={{ background: "#1557b0" }}
              >
                {callout.cta}
              </Hov>
              {HF_NORA_UI ? (
                <button
                  type="button"
                  onClick={() => hf.openNora("talk")}
                  style={{
                    height: 38,
                    border: "1px solid #d2e3fc",
                    borderRadius: 12,
                    background: "#fff",
                    padding: "0 14px",
                    font: "700 13px Arial,sans-serif",
                    color: "#1a73e8",
                    cursor: "pointer",
                  }}
                >
                  Ask NORA about my gaps
                </button>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <section
        style={{
          borderRadius: 24,
          background: "rgba(255,255,255,.95)",
          padding: isD ? 18 : 14,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          boxShadow: "0 4px 12px rgba(66,133,244,.08)",
          animation: "hf-rise .32s ease .14s both",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 17, fontWeight: 700 }}>
            Your gaps vs {rival?.short ?? "the leader"}
          </span>
          <span style={{ fontSize: 12, color: "#80868b" }}>
            Tap a lane and NORA takes it from there
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
            {FILTERS.map((f) => {
              const on = filter === f;
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
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
                  {f} <span style={{ color: on ? "#1967d2" : "#9aa0a6" }}>{model.counts[f]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {tableOn ? (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: TABLE_COLS,
                gap: 14,
                padding: "4px 14px",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                color: "#80868b",
              }}
            >
              <span>Lane</span>
              <span>Status</span>
              <span>Earned / allocated</span>
              <span>You vs {rival?.short ?? "the leader"}</span>
              <span style={{ textAlign: "right", minWidth: 120 }}>NORA action</span>
            </div>
            {rows.map((r) => (
              <Hov
                key={r.lane}
                onClick={() => laneGo(hf, r.to)}
                style={{
                  ...btnBase,
                  display: "grid",
                  gridTemplateColumns: TABLE_COLS,
                  gap: 14,
                  alignItems: "center",
                  borderRadius: 14,
                  background: r.rowBg,
                  padding: "12px 14px",
                  textAlign: "left",
                  font: "14px Arial,sans-serif",
                  color: "#202124",
                  animation: `hf-rise .3s ease ${r.delay} both`,
                }}
                hover={{ background: "#f5f9ff" }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700 }}>
                  <span
                    style={{
                      width: 32,
                      height: 32,
                      flex: "none",
                      borderRadius: 10,
                      background: r.pb,
                      display: "grid",
                      placeItems: "center",
                      color: r.pf,
                    }}
                  >
                    <Ic name={r.icon} size={16} />
                  </span>
                  {r.lane}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      borderRadius: 999,
                      background: r.pb,
                      padding: "4px 10px",
                      fontSize: 12,
                      fontWeight: 700,
                      color: r.pf,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.locked ? <Ic name="lock" size={11} color={r.pf} sw={2.6} /> : null}
                    {r.status}
                  </span>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    style={{
                      width: 78,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      gap: 1,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    <b style={{ fontSize: 15 }}>
                      {r.earned}
                      <span style={{ fontWeight: 400, color: "#80868b" }}> / {r.max}</span>
                    </b>
                    <span style={{ fontSize: 11, color: "#80868b" }}>{r.pts} open</span>
                  </span>
                  <span
                    style={{
                      flex: 1,
                      height: 6,
                      borderRadius: 3,
                      background: "#eceef1",
                      overflow: "hidden",
                    }}
                  >
                    <span
                      style={{
                        display: "block",
                        height: "100%",
                        width: r.barW,
                        borderRadius: 3,
                        background: r.bar,
                        transformOrigin: "left",
                        animation: `hf-grow .7s cubic-bezier(.2,.8,.2,1) ${r.delay} both`,
                      }}
                    />
                  </span>
                </span>
                <span style={{ fontSize: 13, lineHeight: 1.4, color: "#3c4043" }}>{r.cmp}</span>
                {r.act ? (
                  <span
                    style={{
                      justifySelf: "end",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      minHeight: 34,
                      borderRadius: 999,
                      background: r.actBg,
                      padding: "6px 12px",
                      fontSize: 13,
                      fontWeight: 700,
                      lineHeight: 1.2,
                      color: r.actFg,
                      textAlign: "center",
                    }}
                  >
                    {r.act} <Ic name="arrow" size={13} sw={2.4} />
                  </span>
                ) : (
                  <span />
                )}
              </Hov>
            ))}
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {rows.map((r) => (
              <button
                key={r.lane}
                type="button"
                onClick={() => laneGo(hf, r.to)}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  border: 0,
                  borderRadius: 16,
                  background: r.rowBg,
                  padding: 12,
                  textAlign: "left",
                  cursor: "pointer",
                  font: "14px Arial,sans-serif",
                  color: "#202124",
                  animation: `hf-rise .3s ease ${r.delay} both`,
                }}
              >
                <span
                  style={{
                    width: 36,
                    height: 36,
                    flex: "none",
                    borderRadius: 12,
                    background: r.pb,
                    display: "grid",
                    placeItems: "center",
                    color: r.pf,
                  }}
                >
                  <Ic name={r.icon} size={16} />
                </span>
                <div
                  style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <b style={{ fontSize: 15 }}>{r.lane}</b>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        borderRadius: 999,
                        background: r.pb,
                        padding: "2px 8px",
                        fontSize: 11,
                        fontWeight: 700,
                        color: r.pf,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.locked ? <Ic name="lock" size={11} color={r.pf} sw={2.6} /> : null}
                      {r.statusShort}
                    </span>
                  </span>
                  <span style={{ fontSize: 12, lineHeight: 1.4, color: "#5f6368" }}>{r.cmp}</span>
                </div>
                <div
                  style={{
                    flex: "none",
                    width: 56,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 2,
                  }}
                >
                  <b style={{ fontSize: 20, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                    {r.pts}
                  </b>
                  <span style={{ fontSize: 10, color: "#80868b" }}>pts open</span>
                  <span
                    style={{
                      fontSize: 10,
                      color: "#5f6368",
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.earned}
                    <span style={{ color: "#9aa0a6" }}> / {r.max}</span>
                  </span>
                </div>
                {isD && r.act ? (
                  <span
                    style={{
                      flex: "none",
                      width: 176,
                      display: "flex",
                      justifyContent: "flex-end",
                    }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        minHeight: 34,
                        borderRadius: 999,
                        background: r.actBg,
                        padding: "6px 12px",
                        fontSize: 13,
                        fontWeight: 700,
                        color: r.actFg,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.act} <Ic name="arrow" size={13} sw={2.4} />
                    </span>
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        )}
        {model.unknownLanes > 0 ? (
          <span style={{ fontSize: 12, color: "#80868b" }}>
            {model.unknownLanes} {model.unknownLanes === 1 ? "lane" : "lanes"} without points yet
          </span>
        ) : null}
      </section>
    </>
  );
}

export function CalcDialog({
  isD,
  onClose,
  model,
}: {
  isD: boolean;
  onClose: () => void;
  model: SrsModel;
}) {
  const { rival, score } = model;
  const pos: CSSProperties = isD
    ? {
        left: "50%",
        top: "50%",
        width: "min(560px,calc(100% - 48px))",
        maxHeight: "calc(100% - 48px)",
        transform: "translate(-50%,-50%)",
        animation: "hf-modalIn .32s cubic-bezier(.2,.8,.2,1) both",
      }
    : {
        left: 12,
        right: 12,
        top: "50%",
        maxHeight: "calc(100% - 40px)",
        transform: "translateY(-50%)",
        animation: "hf-modalInM .32s cubic-bezier(.2,.8,.2,1) both",
      };
  const p: CSSProperties = { margin: 0, fontSize: 15, lineHeight: 1.55, color: "#3c4043" };
  const band: CSSProperties = {
    borderRadius: 14,
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  };
  const bandSub: CSSProperties = { fontSize: 12, color: "#5f6368" };
  return (
    <>
      <div
        onClick={onClose}
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 40,
          background: "rgba(32,33,36,.28)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          animation: "hf-fadeIn .25s ease both",
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="How your score is calculated"
        style={{
          position: "absolute",
          zIndex: 41,
          borderRadius: 28,
          background: "#fff",
          boxShadow: "0 30px 80px rgba(20,28,48,.32)",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          overflow: "auto",
          ...pos,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <h2
            style={{
              flex: 1,
              margin: 0,
              font: "600 26px/1.2 Lora,Georgia,serif",
              letterSpacing: "-0.01em",
            }}
          >
            How your score is calculated
          </h2>
          <CloseBtn onClick={onClose} />
        </div>
        <p style={p}>
          Your Search Rank Score runs from 0 to {score.max ?? 850}. It adds up what you've earned
          across {model.counts.All} lanes — the things Google and AI look at when they decide which
          lender to show.
        </p>
        <p style={p}>
          <b>Points open</b> is what's still there to earn in each lane.
          {rival
            ? ` ${rival.name} has earned more of them; that's the ${rival.pointsToFirst}-point gap.`
            : ""}
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
          <div style={{ ...band, background: "#fef7e0" }}>
            <b style={{ fontSize: 13, color: "#b06000" }}>{score.band}</b>
            <span style={bandSub}>You are here · {score.total}</span>
          </div>
          {score.nextBand ? (
            <div style={{ ...band, background: "#e6f4ea" }}>
              <b style={{ fontSize: 13, color: "#137333" }}>{score.nextBand.name}</b>
              <span style={bandSub}>From {score.nextBand.min}</span>
            </div>
          ) : null}
          {rival ? (
            <div style={{ ...band, background: "#fce8e6" }}>
              <b style={{ fontSize: 13, color: "#c5221f" }}>#1 target</b>
              <span style={bandSub}>
                {rival.short} · {rival.score}
              </span>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            height: 46,
            border: 0,
            borderRadius: 14,
            background: "#1a73e8",
            font: "700 15px Arial,sans-serif",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          Got it
        </button>
      </div>
    </>
  );
}
