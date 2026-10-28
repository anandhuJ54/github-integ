import { useState } from "react";
import { Ic, NoraFace } from "../primitives";
import { HappyflowShell, useHf } from "../shell";
import { useInsightsModel } from "../insights-context";
import { DEFAULT_SPOT, type InsightsModel } from "@v3/srp/utils/insights-model";

// Demo data (Happyflow prototype)
const HEAD = ["Insights", "How buyers find you, and who they find first."] as const;

const TABS = ["Visibility", "Actions", "Reputation", "Competitors", "NORA impact", "Reports"];

const COMP_COLS = "36px minmax(0,1fr) 92px 84px";

export function InsightsScreen({
  initialTab = "Competitors",
  initialSpot = DEFAULT_SPOT,
}: {
  /** Which tab shows first (the prototype opens on Competitors); the tests use it to render the other live tab. */
  initialTab?: string;
  /** Which map spot is selected first (the office pin). */
  initialSpot?: number;
} = {}) {
  const model = useInsightsModel();
  return (
    <HappyflowShell
      screen="insights"
      day={1}
      title={HEAD[0]}
      sub={HEAD[1]}
      nora={{ thinks: model.thinks }}
    >
      <InsightsBody model={model} initialTab={initialTab} initialSpot={initialSpot} />
    </HappyflowShell>
  );
}

function InsightsBody({
  model,
  initialTab,
  initialSpot,
}: {
  model: InsightsModel;
  initialTab: string;
  initialSpot: number;
}) {
  const hf = useHf();
  const { isD } = hf;
  const [tab, setTab] = useState(initialTab);
  const [spot, setSpot] = useState(initialSpot);
  const [compQ, setCompQ] = useState<"yes" | "no" | null>(null);

  const spotCell = model.map?.cells.find((c) => c.i === spot);
  const rk = spotCell ? (spotCell.rank === null ? "20+" : String(spotCell.rank)) : "";
  const spotTop = (spotCell?.leaders ?? []).map((l) => ({
    r: l.place,
    n: l.name,
    bg: l.you ? "#e8f0fe" : "#f8f9fb",
    fw: l.you ? 700 : 400,
  }));

  const cellPx = 40;
  const target = model.target;
  const qText = !target
    ? "Who do you lose deals to?"
    : compQ === "yes"
      ? `Got it — I'll keep ${target} as your target.`
      : compQ === "no"
        ? "Okay. Tell me who you lose deals to and I'll track them instead."
        : `Is ${target} who you lose deals to?`;

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
          {model.visibility.map(({ label: l, value: n, line }, i) => (
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
              <span style={{ fontSize: 11, color: "#80868b" }}>{line}</span>
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
            {model.map ? (
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
                  <span style={{ fontSize: 17, fontWeight: 700 }}>{model.map.heading}</span>
                  {model.map.scanLabel ? (
                    <span style={{ marginLeft: "auto", fontSize: 12, color: "#80868b" }}>
                      {model.map.scanLabel}
                    </span>
                  ) : null}
                </div>
                <div
                  style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: `repeat(7,${cellPx}px)`,
                      gap: 4,
                      flex: "none",
                    }}
                  >
                    {model.map.cells.map((g) => (
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
                        {g.label}
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
                    {spotCell ? (
                      <span style={{ fontSize: 14 }}>
                        You&apos;re <b style={{ color: "#1a73e8" }}>#{rk}</b> here
                      </span>
                    ) : null}
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
                    <span style={{ fontSize: 12, color: "#5f6368" }}>{model.map.summary}</span>
                  </div>
                </div>
              </section>
            ) : null}

            <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
              {model.ai ? (
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
                    style={{
                      fontSize: 28,
                      fontWeight: 700,
                      letterSpacing: "-0.02em",
                      lineHeight: 1,
                    }}
                  >
                    {model.ai.heading}
                  </span>
                  {model.ai.rows.map(({ name: n, share: s, note: why, cited: a, checked: b }) => (
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
              ) : null}

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
                {!compQ || !target ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {target ? (
                      <>
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
                      </>
                    ) : null}
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
                      {target ? "Add another" : "Add a competitor"}
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
              <span style={{ fontSize: 12, color: "#80868b" }}>{model.query}</span>
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
            {model.competitors.map(({ place: r, name: n, you: me, rating: rt, avg }) => {
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
            {model.locked.map(([t, d]) => (
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
