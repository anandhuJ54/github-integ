/**
 * Screens 13, 14 and 16 — NORA home on day 7 (Happyflow prototype, SRP App `sDay7` / `moreVals()`),
 * with the event pop-up banners (screen 14) and, on day 24, the recap window open over it (screen 16;
 * the shell renders the recap window and blurs the page).
 */
import { useEffect, useState, type CSSProperties } from "react";
import { HappyflowShell, useHf, type Think } from "../shell";
import { Ic, NoraFace, ScoreRing, Tick } from "../primitives";
import type { HfIconName } from "../icons";
import type { HfDay } from "../demo-data";
import { useHfDevice } from "../use-hf-device";

// Demo data (Happyflow prototype)
const THINKS: Think[] = [
  {
    t: "You crossed into Established.",
    d: "418 now. Next is the website: 42 points, and the code is written.",
    cta: "Fix my website",
    act: "website",
  },
  {
    t: "Two replies are waiting.",
    d: "Both drafts are ready and compliant. Approve them and I'll post.",
    cta: "Show me",
    act: "close",
  },
];

const DRAFTS: { n: string; s: number; t: string; d: string }[] = [
  {
    n: "Maria L.",
    s: 5,
    t: "Alex walked us through every step of our FHA loan. We closed in 28 days.",
    d: "Thank you, Maria! It was a pleasure helping you and your family get into your new home.",
  },
  {
    n: "James T.",
    s: 4,
    t: "Explained everything clearly. A couple of slow email replies.",
    d: "Thanks, James — I appreciate the honest feedback, and I’m working on faster replies.",
  },
];

const BRIEF: [string, string][] = [
  ["Service areas added", "+6"],
  ["Bio approved", "+8"],
  ["First article published (VOCE free credits)", "+12"],
  ["2 replies posted", "+2"],
];

const TILES: { icon: HfIconName; l: string; v: string; n: string; lk: boolean }[] = [
  { icon: "pin", l: "Top-3 map spots", v: "9 of 49", n: "Last scan Oct 16", lk: true },
  { icon: "spark", l: "AI citations", v: "1 of 7", n: "Last check Oct 16", lk: true },
  { icon: "star", l: "Reviews", v: "4.9", n: "from 130 reviews", lk: false },
  { icon: "user", l: "Profile strength", v: "72%", n: "up from 64%", lk: false },
];

const YEARS = Array.from({ length: 37 }, (_, i) => String(2026 - i));

type EventKind = "review" | "fb";

export function HomeDay7Screen({ day, events }: { day: Exclude<HfDay, 1>; events: boolean }) {
  const { isM } = useHfDevice();
  const [greet, setGreet] = useState("Good morning");
  const [banner, setBanner] = useState<EventKind | null>(null);

  useEffect(() => {
    const hr = new Date().getHours();
    setGreet(hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening");
  }, []);

  return (
    <HappyflowShell
      screen="home"
      day={day}
      home
      title={`${greet}, Alex`}
      sub={isM ? `Day ${day} of 30 · NORA is on it` : "Here is what happened while you were away."}
      banner={banner ? <EventBanner kind={banner} onClose={() => setBanner(null)} /> : null}
      nora={{ thinks: THINKS }}
      initialWin={day === 24 ? "recap" : null}
    >
      <Day7Body events={events} setBanner={setBanner} />
    </HappyflowShell>
  );
}

/** Screen 14 banner: a 2★ review (red) or an expiring Facebook connection (yellow). */
function EventBanner({ kind, onClose }: { kind: EventKind; onClose: () => void }) {
  const hf = useHf();
  const fb = kind === "fb";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        borderRadius: 18,
        background: fb ? "#fef7e0" : "#fce8e6",
        border: `1.5px solid ${fb ? "#fbe3a4" : "#f6c7c3"}`,
        padding: "12px 14px",
        animation: "hf-slideDown .35s cubic-bezier(.2,.8,.2,1) both",
      }}
    >
      <NoraFace size={32} />
      <span style={{ flex: "1 1 220px", fontSize: 14, lineHeight: 1.45, color: "#202124" }}>
        {fb
          ? "Your Facebook connection expires Friday. Reconnect to keep your social points."
          : "A 2★ review from Kevin P. needs you today. I drafted a calm, compliant reply."}
      </span>
      <button
        type="button"
        onClick={() => {
          if (fb) {
            onClose();
            hf.toast("Facebook reconnected · good for 60 days");
          } else hf.go("reviews");
        }}
        style={{
          height: 38,
          border: 0,
          borderRadius: 12,
          background: fb ? "#b06000" : "#c5221f",
          padding: "0 14px",
          font: "700 13px Arial,sans-serif",
          color: "#fff",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {fb ? "Reconnect" : "Review the draft"}
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss"
        style={{
          width: 32,
          height: 32,
          border: 0,
          borderRadius: "50%",
          background: "rgba(255,255,255,.7)",
          display: "grid",
          placeItems: "center",
          cursor: "pointer",
          color: "#5f6368",
        }}
      >
        <Ic name="x" size={16} />
      </button>
    </div>
  );
}

function Day7Body({
  events,
  setBanner,
}: {
  events: boolean;
  setBanner: (k: EventKind | null) => void;
}) {
  const hf = useHf();
  const { isD, openNora } = hf;
  const [approved, setApproved] = useState<Record<number, boolean>>({});
  const [undo, setUndo] = useState<{ i: number; s: number } | null>(null);
  const [year, setYear] = useState("2014");
  const [yearSaved, setYearSaved] = useState(false);

  // Screen 14: the 2★ review arrives 900 ms after the page opens.
  useEffect(() => {
    if (!events) return;
    const t = setTimeout(() => setBanner("review"), 900);
    return () => clearTimeout(t);
  }, [events, setBanner]);

  // Demo bar event buttons (2★ review · Facebook · Upgrade).
  useEffect(() => {
    const on = (e: Event) => {
      const kind = (e as CustomEvent<unknown>).detail;
      if (kind === "review" || kind === "fb") setBanner(kind);
      else if (kind === "upgrade") openNora("upgrade");
    };
    window.addEventListener("hf-event", on);
    return () => window.removeEventListener("hf-event", on);
  }, [openNora, setBanner]);

  // 10-second Undo countdown after approving a reply.
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo((u) => (u && u.s > 1 ? { ...u, s: u.s - 1 } : null)), 1000);
    return () => clearTimeout(t);
  }, [undo]);

  const colDisp = isD ? "flex" : "contents";
  const col: CSSProperties = { display: colDisp, flexDirection: "column", gap: 16, minWidth: 0 };
  const o = (n: number) => (isD ? 0 : n);
  const card: CSSProperties = {
    background: "rgba(255,255,255,.95)",
    boxShadow: "0 4px 12px rgba(66,133,244,.08)",
  };
  const dot: CSSProperties = { width: 12, height: 12, borderRadius: "50%", background: "#34a853" };

  return (
    <div
      style={{
        display: "grid",
        gap: 16,
        ...(isD
          ? { gridTemplateColumns: "minmax(0,8fr) minmax(0,4fr)", alignItems: "start" }
          : { gridTemplateColumns: "minmax(0,1fr)" }),
      }}
    >
      <div style={col}>
        <section
          style={{
            order: o(1),
            display: "flex",
            gap: 12,
            alignItems: "center",
            borderRadius: 20,
            background: "#e6f4ea",
            border: "1.5px solid #ceead6",
            padding: "14px 16px",
            animation: "hf-rise .32s ease both",
          }}
        >
          <NoraFace size={40} />
          <span style={{ flex: 1, fontSize: 15, lineHeight: 1.5 }}>
            <b>While you were away:</b> 2 new reviews, your bio went live and your first article is
            published.
          </span>
        </section>
        <section
          style={{
            order: o(2),
            position: "relative",
            overflow: "hidden",
            borderRadius: 24,
            backgroundImage:
              "radial-gradient(120% 90% at 0% 0%,oklch(0.965 0.021 30) 0%,transparent 55%),radial-gradient(110% 90% at 100% 0%,oklch(0.955 0.025 285) 0%,transparent 55%),linear-gradient(180deg,oklch(0.985 0.004 285),#fff)",
            padding: 20,
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            alignItems: "center",
            gap: 22,
            boxShadow: "0 12px 32px rgba(66,133,244,.12)",
            animation: "hf-rise .32s ease .05s both",
          }}
        >
          <ScoreRing px={isD ? 180 : 170} ns={40} value={hf.score} id="hfRingDay7" />
          <div
            style={{
              flex: "1 1 220px",
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <span
              style={{
                alignSelf: "flex-start",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                borderRadius: 999,
                background: "#34a853",
                padding: "6px 14px",
                fontSize: 14,
                fontWeight: 700,
                color: "#fff",
                animation: "hf-pop .5s cubic-bezier(.2,.8,.2,1) .4s both",
              }}
            >
              <Tick size={14} />
              You&apos;re Established
            </span>
            <span style={{ fontSize: 15, fontWeight: 700, color: "#1e8e3e" }}>▲ 28 this week</span>
            <span style={{ fontSize: 15 }}>
              <b>#5 of 41</b> in Davenport
            </span>
            <span style={{ fontSize: 13, color: "#5f6368" }}>
              You crossed 400 on day 6. Next band target: Riverbend at 571.
            </span>
          </div>
        </section>
        <section
          style={{
            order: o(5),
            display: "flex",
            flexDirection: "column",
            gap: 10,
            borderRadius: 20,
            background: "#eef3fe",
            border: "1.5px solid #d2e3fc",
            padding: "14px 16px",
            animation: "hf-rise .32s ease .1s both",
          }}
        >
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <NoraFace size={26} />
            <span style={{ flex: 1, fontSize: 15, lineHeight: 1.45 }}>
              <b>When did you start in mortgage?</b> It strengthens your Identity score.
            </span>
          </div>
          {!yearSaved ? (
            <div style={{ display: "flex", gap: 8 }}>
              <select
                value={year}
                onChange={(e) => setYear(e.target.value)}
                aria-label="Year you started in mortgage"
                style={{
                  flex: 1,
                  maxWidth: 200,
                  height: 42,
                  border: "1.5px solid #d2e3fc",
                  borderRadius: 12,
                  background: "#fff",
                  padding: "0 12px",
                  font: "600 15px Arial,sans-serif",
                  color: "#202124",
                }}
              >
                {YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  setYearSaved(true);
                  hf.toast("Saved · Identity is stronger");
                }}
                style={{
                  height: 42,
                  border: 0,
                  borderRadius: 12,
                  background: "#1a73e8",
                  padding: "0 18px",
                  font: "700 14px Arial,sans-serif",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                Save
              </button>
            </div>
          ) : (
            <span style={{ fontSize: 13, fontWeight: 700, color: "#137333" }}>
              Saved · started in {year}
            </span>
          )}
        </section>
        <section
          style={{
            order: o(6),
            display: "grid",
            gridTemplateColumns: "repeat(2,minmax(0,1fr))",
            gap: 12,
          }}
        >
          {TILES.map((t) => (
            <button
              type="button"
              key={t.l}
              onClick={() =>
                t.lk ? hf.out("Billing") : t.icon === "user" ? hf.go("profile") : hf.go("reviews")
              }
              style={{
                ...card,
                border: 0,
                borderRadius: 20,
                padding: 14,
                display: "flex",
                flexDirection: "column",
                gap: 8,
                textAlign: "left",
                cursor: "pointer",
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
                <Ic name={t.icon} size={15} color="#1a73e8" />
                <span style={{ flex: 1 }}>{t.l}</span>
                {t.lk ? <Ic name="lock" size={14} color="#b06000" /> : null}
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
                {t.v}
              </span>
              <span style={{ fontSize: 12, color: "#5f6368" }}>{t.n}</span>
            </button>
          ))}
        </section>
        <section
          style={{
            ...card,
            order: o(7),
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            borderRadius: 20,
            padding: "14px 16px",
          }}
        >
          <span style={{ display: "flex", gap: 4 }}>
            <span style={dot} />
            <span style={dot} />
            <span
              style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid #c6dafc" }}
            />
          </span>
          <b style={{ fontSize: 14 }}>2 of 3 moves this week</b>
          <span
            style={{
              marginLeft: "auto",
              borderRadius: 999,
              background: "#fef7e0",
              padding: "4px 10px",
              fontSize: 12,
              fontWeight: 700,
              color: "#b06000",
            }}
          >
            Streak · 1 week
          </span>
        </section>
      </div>

      <div style={col}>
        <section
          style={{
            order: o(3),
            borderRadius: 24,
            background: "rgba(255,255,255,.96)",
            padding: 18,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            boxShadow: "0 12px 32px rgba(66,133,244,.12)",
            animation: "hf-rise .32s ease .08s both",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <NoraFace size={36} mood="done" />
            <span
              style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".12em", color: "#7b4ce0" }}
            >
              WEEKLY BRIEF
            </span>
          </div>
          <h2
            style={{
              margin: 0,
              font: "600 28px/1.15 Lora,Georgia,serif",
              letterSpacing: "-0.01em",
            }}
          >
            Up 28 this week
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {BRIEF.map(([t, p]) => (
              <div key={t} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
                <span
                  style={{
                    width: 18,
                    height: 18,
                    flex: "none",
                    borderRadius: "50%",
                    background: "#34a853",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  <Tick size={9} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>{t}</span>
                <b style={{ color: "#137333", fontVariantNumeric: "tabular-nums" }}>{p}</b>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => hf.go("website")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              border: "1.5px solid #c6dafc",
              borderRadius: 16,
              background: "#f5f9ff",
              padding: "12px 14px",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
              <span
                style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em", color: "#7b4ce0" }}
              >
                NEXT MOVE
              </span>
              <b style={{ fontSize: 15 }}>Fix my website · +42</b>
            </span>
            <span style={{ display: "flex", transform: "rotate(180deg)" }}>
              <Ic name="back" size={16} color="#1a73e8" />
            </span>
          </button>
        </section>
        <section
          style={{
            order: o(4),
            display: "flex",
            flexDirection: "column",
            gap: 10,
            animation: "hf-rise .32s ease .12s both",
          }}
        >
          <span
            style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700 }}
          >
            Needs you{" "}
            <span
              style={{
                minWidth: 22,
                height: 22,
                borderRadius: 11,
                background: "#ea4335",
                display: "grid",
                placeItems: "center",
                fontSize: 12,
                color: "#fff",
              }}
            >
              2
            </span>
          </span>
          {DRAFTS.map((d, i) => {
            const ok = !!approved[i];
            const undoTxt = undo && undo.i === i ? `Undo · ${undo.s}s` : "";
            return (
              <div
                key={d.n}
                style={{
                  borderRadius: 20,
                  background: "rgba(255,255,255,.96)",
                  padding: 14,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  boxShadow: "0 4px 12px rgba(66,133,244,.08)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <b style={{ fontSize: 14 }}>{d.n}</b>
                  <span style={{ fontSize: 13, letterSpacing: 1, color: "#f9ab00" }}>
                    {"★★★★★".slice(0, d.s) + "☆☆☆☆☆".slice(0, 5 - d.s)}
                  </span>
                </div>
                <span style={{ fontSize: 13, lineHeight: 1.45, color: "#3c4043" }}>
                  &quot;{d.t}&quot;
                </span>
                {!ok ? (
                  <>
                    <div
                      style={{
                        borderRadius: 14,
                        background: "#eef3fe",
                        padding: "10px 12px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: ".08em",
                          color: "#7b4ce0",
                        }}
                      >
                        NORA&apos;S DRAFT
                      </span>
                      <span style={{ fontSize: 13, lineHeight: 1.45 }}>{d.d}</span>
                      <span
                        style={{
                          alignSelf: "flex-start",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          borderRadius: 999,
                          background: "#e6f4ea",
                          padding: "2px 8px",
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#137333",
                        }}
                      >
                        <Ic name="shield" size={12} color="#137333" sw={2.4} />
                        Compliant
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => {
                          setApproved((a) => ({ ...a, [i]: true }));
                          setUndo({ i, s: 10 });
                        }}
                        style={{
                          flex: 1,
                          height: 40,
                          border: 0,
                          borderRadius: 12,
                          background: "#1a73e8",
                          font: "700 14px Arial,sans-serif",
                          color: "#fff",
                          cursor: "pointer",
                        }}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          hf.openSheet(
                            {
                              title: "Edit reply to " + d.n,
                              ph: "Reply",
                              cta: "Approve reply",
                              nora: "Compliant · no rate promises · NMLS shown on your profile.",
                              input: true,
                              done: "Reply posted",
                            },
                            d.d,
                          )
                        }
                        style={{
                          height: 40,
                          border: "1px solid #dadce0",
                          borderRadius: 12,
                          background: "#fff",
                          padding: "0 16px",
                          font: "700 14px Arial,sans-serif",
                          color: "#3c4043",
                          cursor: "pointer",
                        }}
                      >
                        Edit
                      </button>
                    </div>
                  </>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      borderRadius: 12,
                      background: "#e6f4ea",
                      padding: "10px 12px",
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#137333",
                      animation: "hf-pop .35s ease both",
                    }}
                  >
                    <Tick size={14} color="#137333" />
                    <span style={{ flex: 1 }}>Posted · +1 point</span>
                    {undoTxt ? (
                      <button
                        type="button"
                        onClick={() => {
                          setApproved((a) => {
                            const n = { ...a };
                            delete n[i];
                            return n;
                          });
                          setUndo(null);
                        }}
                        style={{
                          border: 0,
                          background: "none",
                          padding: 0,
                          font: "700 13px Arial,sans-serif",
                          color: "#1a73e8",
                          cursor: "pointer",
                        }}
                      >
                        {undoTxt}
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}
