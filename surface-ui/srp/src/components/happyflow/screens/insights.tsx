import { useState } from "react";
import { GRID, RIVALS } from "../demo-data";
import { Ic, NoraFace } from "../primitives";
import { HappyflowShell, useHf, type Think } from "../shell";
import { usePersonalize } from "../persona-context";

// Demo data (Happyflow prototype)
const HEAD = ["Insights", "How buyers find you, and who they find first."] as const;

const THINKS: Think[] = [
  {
    t: "Riverbend wins on volume.",
    d: "412 reviews and 14 articles. Your 4.9 rating is better than their 4.7.",
    cta: "Start publishing",
    act: "voce",
  },
  {
    t: "Perplexity cites articles.",
    d: "You have none, so it never names you. One article changes that.",
    cta: "Write my first article",
    act: "voce",
  },
];

const TABS = ["Visibility", "Actions", "Reputation", "Competitors", "NORA impact", "Reports"];

const VIS_STATS: [string, string][] = [
  ["Search views", "1,240"],
  ["Maps views", "860"],
  ["Calls", "41"],
  ["Directions", "18"],
  ["Website clicks", "57"],
  ["Experience.com profile views", "312"],
];

const AI_ROWS: [string, string, string, number, number][] = [
  ["ChatGPT", "1 of 3", "Cites your Zillow reviews", 1, 3],
  ["Gemini", "0 of 2", "Leans on the map pack", 0, 2],
  ["Perplexity", "0 of 2", "Cites articles; you have none", 0, 2],
];

const COMPS: [number, string, string, string][] = [
  [1, "Riverbend Bank & Trust", "4.7 (412)", "2.1"],
  [2, "Prairie Home Lending", "4.8 (230)", "3.4"],
  [3, "Bluff City Mortgage", "4.6 (188)", "4.0"],
  [4, "Mississippi Valley Loans", "4.5 (96)", "5.2"],
  [5, "Heartland Credit Union", "4.4 (151)", "5.9"],
  [6, "Alex Sample (you)", "4.9 (128)", "7.8"],
];

const INS_LOCKED: [string, string][] = [
  ["Map Rank tracking", "Re-scan every week and see the day you pass Riverbend"],
  ["AI-citation monitoring", "Track every answer that names you"],
];

const COMP_COLS = "36px minmax(0,1fr) 92px 84px";

export function InsightsScreen() {
  return (
    <HappyflowShell
      screen="insights"
      day={1}
      title={HEAD[0]}
      sub={HEAD[1]}
      nora={{ thinks: THINKS }}
    >
      <InsightsBody />
    </HappyflowShell>
  );
}

function InsightsBody() {
  const t = usePersonalize();
  const hf = useHf();
  const { isD } = hf;
  const [tab, setTab] = useState("Competitors");
  const [spot, setSpot] = useState(24);
  const [compQ, setCompQ] = useState<"yes" | "no" | null>(null);

  const spotCell = GRID[spot];
  const rk = spotCell.rank;
  const rkN = typeof rk === "number" ? rk : 21;
  const rot = spot % 3;
  const base = [RIVALS[rot % 3], RIVALS[(rot + 1) % 3], RIVALS[(rot + 2) % 3]];
  if (rkN <= 3) base.splice(rkN - 1, 0, "You");
  const spotTop = base.slice(0, 3).map((n, i) => ({
    r: i + 1,
    n,
    bg: n === "You" ? "#e8f0fe" : "#f8f9fb",
    fw: n === "You" ? 700 : 400,
  }));

  const cellPx = 40;
  const qText =
    compQ === "yes"
      ? "Got it — I'll keep Riverbend Bank & Trust as your target."
      : compQ === "no"
        ? "Okay. Tell me who you lose deals to and I'll track them instead."
        : "Is Riverbend Bank & Trust who you lose deals to?";

  const qAdd = () =>
    hf.openSheet(
      {
        title: "Add a competitor",
        ph: "Lender name",
        cta: "Add",
        nora: "I'll map them on the same 49 spots.",
        input: true,
        done: "Added · I'll include them in the next scan",
      },
      "",
    );

  return (
    <>
      <div style={{ display: "flex", gap: 6, overflowX: "auto", margin: "0 -2px", padding: 2 }}>
        {TABS.map((l) => {
          const on = tab === l;
          const live = l === "Visibility" || l === "Competitors";
          return (
            <button
              key={l}
              type="button"
              onClick={
                live ? () => setTab(l) : () => hf.toast(l + " is not part of this prototype")
              }
              style={{
                flex: "none",
                height: 36,
                border: `1px solid ${on ? "#1a73e8" : "#e3e5e8"}`,
                borderRadius: 999,
                background: on ? "#e8f0fe" : "#fff",
                padding: "0 14px",
                font: "700 13px Arial,sans-serif",
                color: on ? "#1967d2" : live ? "#3c4043" : "#9aa0a6",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {l}
            </button>
          );
        })}
      </div>

      {tab === "Visibility" ? (
        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: isD ? "repeat(3,minmax(0,1fr))" : "repeat(2,minmax(0,1fr))",
          }}
        >
          {VIS_STATS.map(([l, n], i) => (
            <section
              key={l}
              style={{
                borderRadius: 20,
                background: "rgba(255,255,255,.95)",
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 6,
                boxShadow: "0 4px 12px rgba(66,133,244,.08)",
                animation: `hf-rise .3s ease ${i * 40}ms both`,
              }}
            >
              <span style={{ fontSize: 13, color: "#5f6368" }}>{l}</span>
              <span
                style={{
                  fontSize: 32,
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  lineHeight: 1,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {n}
              </span>
              <span style={{ fontSize: 11, color: "#80868b" }}>Last 30 days · from Google</span>
            </section>
          ))}
        </div>
      ) : null}

      {tab === "Competitors" ? (
        <>
          <div
            style={{
              display: "grid",
              gap: 16,
              alignItems: "start",
              gridTemplateColumns: isD ? "minmax(0,1.15fr) minmax(0,1fr)" : "minmax(0,1fr)",
            }}
          >
            <section
              style={{
                borderRadius: 24,
                background: "rgba(255,255,255,.95)",
                padding: 18,
                display: "flex",
                flexDirection: "column",
                gap: 12,
                boxShadow: "0 12px 32px rgba(66,133,244,.12)",
                animation: "hf-rise .32s ease both",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 17, fontWeight: 700 }}>Map rank around 100 Main St</span>
                <span style={{ marginLeft: "auto", fontSize: 12, color: "#80868b" }}>
                  One-time scan · Oct 16
                </span>
              </div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(7,${cellPx}px)`,
                    gap: 4,
                    flex: "none",
                  }}
                >
                  {GRID.map((g) => (
                    <button
                      key={g.i}
                      type="button"
                      onClick={() => setSpot(g.i)}
                      style={{
                        width: cellPx,
                        height: cellPx,
                        border: 0,
                        borderRadius: 8,
                        background: g.bg,
                        boxShadow: g.i === spot ? "0 0 0 3px #fff,0 0 0 5px #1a73e8" : "none",
                        display: "grid",
                        placeItems: "center",
                        font: "700 11px Arial,sans-serif",
                        color: g.fg,
                        cursor: "pointer",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {g.i === 24 ? "●" : String(g.rank)}
                    </button>
                  ))}
                </div>
                <div
                  style={{
                    flex: "1 1 180px",
                    minWidth: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: ".1em",
                      color: "#80868b",
                    }}
                  >
                    AT THIS SPOT
                  </span>
                  <span style={{ fontSize: 14 }}>
                    You&apos;re <b style={{ color: "#1a73e8" }}>#{String(rk)}</b> here
                  </span>
                  {spotTop.map((t) => (
                    <div
                      key={t.r}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        borderRadius: 12,
                        background: t.bg,
                        padding: "9px 12px",
                        fontSize: 13,
                        fontWeight: t.fw,
                      }}
                    >
                      <span style={{ width: 22, color: "#80868b" }}>#{t.r}</span>
                      <span style={{ flex: 1 }}>{t.n}</span>
                    </div>
                  ))}
                  <span style={{ fontSize: 12, color: "#5f6368" }}>
                    Top 3 in 9 · 4–10 in 17 · 11–20 in 14 · 20+ in 9
                  </span>
                </div>
              </div>
            </section>

            <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
              <section
                style={{
                  borderRadius: 24,
                  background: "rgba(255,255,255,.95)",
                  padding: 18,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  boxShadow: "0 4px 12px rgba(66,133,244,.08)",
                  animation: "hf-rise .32s ease .06s both",
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
                  }}
                >
                  <Ic name="spark" size={14} color="#7b4ce0" />
                  AI citations
                </span>
                <span
                  style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1 }}
                >
                  Named in 1 of 7 answers
                </span>
                {AI_ROWS.map(([n, s, why, a, b]) => (
                  <div
                    key={n}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      borderRadius: 12,
                      background: "#f8f9fb",
                      padding: "10px 12px",
                    }}
                  >
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                      }}
                    >
                      <b style={{ fontSize: 14 }}>
                        {n} <span style={{ fontWeight: 400, color: "#5f6368" }}>{s}</span>
                      </b>
                      <span style={{ fontSize: 12, color: "#5f6368" }}>{why}</span>
                    </div>
                    <span style={{ display: "flex", gap: 3 }}>
                      {Array.from({ length: b }, (_, i) => (
                        <span
                          key={i}
                          style={{
                            width: 9,
                            height: 9,
                            borderRadius: "50%",
                            background: i < a ? "#9b72f2" : "#dadce0",
                          }}
                        />
                      ))}
                    </span>
                  </div>
                ))}
              </section>

              <section
                style={{
                  borderRadius: 24,
                  background: "#eef3fe",
                  border: "1.5px solid #d2e3fc",
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  animation: "hf-rise .32s ease .12s both",
                }}
              >
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <NoraFace size={26} mood="idle" />
                  <span style={{ flex: 1, fontSize: 15, lineHeight: 1.45, fontWeight: 700 }}>
                    {qText}
                  </span>
                </div>
                {!compQ ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => setCompQ("yes")}
                      style={{
                        height: 38,
                        border: 0,
                        borderRadius: 12,
                        background: "#1a73e8",
                        padding: "0 18px",
                        font: "700 13px Arial,sans-serif",
                        color: "#fff",
                        cursor: "pointer",
                      }}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setCompQ("no")}
                      style={{
                        height: 38,
                        border: "1px solid #d2e3fc",
                        borderRadius: 12,
                        background: "#fff",
                        padding: "0 18px",
                        font: "700 13px Arial,sans-serif",
                        color: "#1a73e8",
                        cursor: "pointer",
                      }}
                    >
                      No
                    </button>
                    <button
                      type="button"
                      onClick={qAdd}
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
                      Add another
                    </button>
                  </div>
                ) : null}
              </section>
            </div>
          </div>

          <section
            style={{
              borderRadius: 24,
              background: "rgba(255,255,255,.95)",
              padding: isD ? "18px" : "12px",
              display: "flex",
              flexDirection: "column",
              gap: 4,
              boxShadow: "0 4px 12px rgba(66,133,244,.08)",
              animation: "hf-rise .32s ease .16s both",
            }}
          >
            <div
              style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "2px 4px 8px" }}
            >
              <span style={{ fontSize: 17, fontWeight: 700 }}>Competitors</span>
              <span style={{ fontSize: 12, color: "#80868b" }}>
                &quot;mortgage lender near me&quot; · Davenport, IA
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: COMP_COLS,
                gap: 10,
                padding: "0 12px 4px",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                color: "#80868b",
              }}
            >
              <span>Rank</span>
              <span>Name</span>
              <span>Rating</span>
              <span style={{ textAlign: "right" }}>Avg map</span>
            </div>
            {COMPS.map(([r, n0, rt, avg]) => {
              const n = t(n0);
              const me = r === 6;
              return (
                <div
                  key={r}
                  style={{
                    display: "grid",
                    gridTemplateColumns: COMP_COLS,
                    gap: 10,
                    alignItems: "center",
                    borderRadius: 12,
                    background: me ? "#e8f0fe" : r % 2 ? "#fafbfd" : "transparent",
                    padding: "11px 12px",
                    fontSize: 14,
                    fontWeight: me ? 700 : 400,
                    color: me ? "#1967d2" : "#202124",
                  }}
                >
                  <span style={{ color: "#80868b", fontVariantNumeric: "tabular-nums" }}>{r}</span>
                  <span style={{ minWidth: 0 }}>{n}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>
                    <span style={{ color: "#f9ab00" }}>★</span> {rt}
                  </span>
                  <b style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{avg}</b>
                </div>
              );
            })}
          </section>

          <div
            style={{
              display: "grid",
              gap: 10,
              gridTemplateColumns: isD ? "repeat(2,minmax(0,1fr))" : "minmax(0,1fr)",
            }}
          >
            {INS_LOCKED.map(([t, d]) => (
              <button
                key={t}
                type="button"
                onClick={() => hf.out("Billing")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  border: "1px solid #fbe3a4",
                  borderRadius: 18,
                  background: "#fef7e0",
                  padding: 14,
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    width: 32,
                    height: 32,
                    flex: "none",
                    borderRadius: "50%",
                    background: "#fff",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  <Ic name="lock" size={16} color="#b06000" sw={2.4} />
                </span>
                <span
                  style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}
                >
                  <b style={{ fontSize: 14 }}>{t}</b>
                  <span style={{ fontSize: 13, lineHeight: 1.4, color: "#5f6368" }}>{d}</span>
                </span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#b06000" }}>Unlock →</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
