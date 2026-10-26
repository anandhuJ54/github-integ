/**
 * NORA home, first session (screen 4) — Happyflow prototype "Dashboard", variant B.
 *
 * NORA flies in from the top left ("Hi Alex. I'm here when you need me."), settles into the
 * launcher (desktop) or the bottom bar (mobile), then finishes her first task in front of Alex:
 * "Adding your Google category and services" → Done · +6 points, score 384 → 390.
 * Demo data only; nothing is read from or written to the database.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { HappyflowShell, useHf, type Think, HF_NORA_UI } from "../shell";
import { PERSONA, GRID, RIVERBEND_SCORE, SCORE_AT_LANDING } from "../demo-data";
import {
  Hov,
  Ic,
  NoraFace,
  PEARL,
  ScoreRing,
  Tick,
  prefersReducedMotion,
  useReducedMotion,
  type NoraMood,
} from "../primitives";
import type { HfIconName } from "../icons";

// Demo data (Happyflow prototype)
const SCORE_AT_CLAIM = 298;
const TASK_POINTS = 6;
const FACE_SHADOW = "0 6px 18px rgba(155,114,242,.35)";

const MOVES: {
  icon: HfIconName;
  t: string;
  sub: string;
  rec: boolean;
  to: "voce" | "website" | "profile";
}[] = [
  {
    icon: "pen",
    t: "Start publishing",
    sub: "Your biggest gap: 0 articles to Riverbend's 14. Free VOCE credits.",
    rec: true,
    to: "voce",
  },
  {
    icon: "wrench",
    t: "Fix my website",
    sub: "Markup is missing · health 40 of 102",
    rec: false,
    to: "website",
  },
  {
    icon: "award",
    t: "Add your credentials",
    sub: "Certifications and awards for your profile",
    rec: false,
    to: "profile",
  },
];

const DONE_BEFORE: [string, string][] = [
  ["Fixed 4 places", "+19"],
  ["Kept 9 loan products", "+13"],
  ["Built your profile · 67 facts", "+54"],
  ["Mapped 5 competitors", ""],
];

const LOCKED: { t: string; d: string; pts: string }[] = [
  {
    t: "Listings",
    d: "22 directories are missing you or show your old phone. 42 points are waiting.",
    pts: "+42",
  },
  { t: "VOCE", d: "No articles yet. 85 points are in Articles.", pts: "+85" },
  { t: "Map Rank tracking", d: "See the week you pass Riverbend.", pts: "" },
];

const THINKS: Think[] = [
  {
    t: "Riverbend's lead is mostly content.",
    d: "They have 14 articles to your 0 — 85 points are sitting in Articles. Publishing is the fastest way to close the gap.",
    cta: "Start publishing",
    act: "voce",
  },
  {
    t: "Your reviews are better — there are just fewer.",
    d: "Yours average 4.9 to their 4.7, but they have 412 to your 128.",
    cta: "See reviews",
    act: "reviews",
  },
  {
    t: "AI barely knows you yet.",
    d: "ChatGPT names you in 1 of 7 answers. Your website is missing the markup AI reads.",
    cta: "Want to see why?",
    act: "insights",
  },
];

const CHIPS = [
  "Where am I losing to Riverbend?",
  "What should I fix first?",
  "Write my first article",
  "Why is my score 390?",
  "Show my map",
];

const ORBS: [string, string, string, number][] = [
  ["#4285f4", "-8%", "-30%", 0],
  ["#ea4335", "62%", "-40%", 2],
  ["#fbbc04", "78%", "55%", 4],
  ["#34a853", "18%", "65%", 6],
];

const MINI = GRID.map((g) => ({
  i: g.i,
  bg: g.i === 24 ? "#1a73e8" : g.bg,
  sh: g.i === 24 ? "0 0 0 1.5px #fff" : "none",
}));

type Intro = "fly" | "land" | "done";

type Task = { pct: number; done: boolean; smiling: boolean; score: number };

const TASK_START: Task = { pct: 0, done: false, smiling: false, score: SCORE_AT_LANDING };

function greeting() {
  const hr = new Date().getHours();
  return hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
}

export function HomeDay1Screen() {
  const [greet] = useState(greeting);
  // With the NORA UI off there is no arrival flyer — the first task starts straight away.
  const [intro, setIntro] = useState<Intro>(HF_NORA_UI ? "fly" : "done");
  const [bubble, setBubble] = useState(false);
  const [introRun, setIntroRun] = useState(0);
  const [taskRun, setTaskRun] = useState(0);
  const [task, setTask] = useState<Task>(TASK_START);

  const replay = useCallback(() => {
    setTask(TASK_START);
    setBubble(false);
    if (!HF_NORA_UI) {
      setTaskRun((r) => r + 1);
      return;
    }
    setIntro("fly");
    setIntroRun((r) => r + 1);
  }, []);

  const onLand = useCallback(() => {
    setBubble(true);
    setIntro("land");
  }, []);
  const onBubbleOff = useCallback(() => setBubble(false), []);
  const onArrived = useCallback(() => {
    setBubble(false);
    setTask(TASK_START);
    setIntro("done");
    setTaskRun((r) => r + 1);
  }, []);

  // First task: 0 → 100 % in 2 % steps every 70 ms, then the score counts 384 → 390.
  useEffect(() => {
    if (intro !== "done") return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let iv: ReturnType<typeof setInterval> | undefined;
    let raf = 0;
    if (prefersReducedMotion()) {
      timers.push(
        setTimeout(
          () =>
            setTask({
              pct: 100,
              done: true,
              smiling: false,
              score: SCORE_AT_LANDING + TASK_POINTS,
            }),
          0,
        ),
      );
    } else {
      let pct = 0;
      const finish = () => {
        setTask((t) => ({ ...t, pct: 100, done: true, smiling: true }));
        const t0 = performance.now();
        const d = 900;
        const step = (now: number) => {
          const p = Math.min(1, (now - t0) / d);
          const e = 1 - Math.pow(1 - p, 3);
          setTask((t) => ({ ...t, score: Math.round(SCORE_AT_LANDING + TASK_POINTS * e) }));
          if (p < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
        timers.push(setTimeout(() => setTask((t) => ({ ...t, smiling: false })), 3200));
      };
      timers.push(
        setTimeout(() => {
          iv = setInterval(() => {
            pct += 2;
            if (pct >= 100) {
              clearInterval(iv);
              finish();
            } else {
              const p = pct;
              setTask((t) => ({ ...t, pct: p }));
            }
          }, 70);
        }, 700),
      );
    }
    return () => {
      timers.forEach(clearTimeout);
      if (iv) clearInterval(iv);
      cancelAnimationFrame(raf);
    };
  }, [intro, taskRun]);

  const mode: NoraMood = !task.done ? "working" : task.smiling ? "done" : "idle";
  const liveBg = task.done ? "#e6f4ea" : "#eef3fe";
  const liveBd = task.done ? "#ceead6" : "#d2e3fc";
  const taskFg = task.done ? "#137333" : "#1967d2";
  const barBg = task.done ? "#34a853" : "linear-gradient(90deg,#4285f4,#9b72f2,#4285f4)";
  const taskNote = task.done ? `Done · +${TASK_POINTS} points` : `${task.pct}%`;
  const statusIc = <StatusIcon done={task.done} />;

  return (
    <HappyflowShell
      screen="home"
      day={1}
      home
      title={`${greet}, ${PERSONA.first}`}
      sub={<HomeSub />}
      hideLauncher={intro !== "done"}
      nora={{
        status: task.done ? "All caught up · on for you 30 days" : "Working on 1 task",
        intro: (
          <div
            style={{
              borderRadius: 16,
              background: liveBg,
              border: `1.5px solid ${liveBd}`,
              padding: "12px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              {statusIc}Adding your Google category and services
            </span>
            <div
              style={{
                height: 5,
                borderRadius: 3,
                background: "rgba(26,115,232,.14)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${task.pct}%`,
                  borderRadius: 3,
                  background: barBg,
                  transition: "width .25s linear",
                }}
              />
            </div>
            <b style={{ fontSize: 12, color: taskFg }}>{taskNote}</b>
          </div>
        ),
        thinks: THINKS,
        outro: (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span
                style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".12em", color: "#5f6368" }}
              >
                NEEDS YOU
              </span>
              <div
                style={{
                  borderRadius: 16,
                  border: "1.5px dashed #dadce0",
                  padding: "12px 14px",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <NoraFace size={32} mood="idle" shadow={FACE_SHADOW} />
                <span style={{ fontSize: 14, lineHeight: 1.4 }}>
                  <b>Nothing needs you right now.</b>{" "}
                  <span style={{ color: "#5f6368" }}>I&apos;m on it.</span>
                </span>
              </div>
            </div>
            <div
              style={{
                borderRadius: "4px 18px 18px 18px",
                background: "#f5f7fb",
                padding: "12px 14px",
                fontSize: 14,
                lineHeight: 1.5,
              }}
            >
              For the next 30 days I&apos;m fully on for you. I&apos;ll text you{" "}
              <b>Tuesday early morning</b> with what I&apos;ve done.
            </div>
          </>
        ),
        chips: CHIPS,
        launcherText: (
          <>
            {statusIc}
            {task.done ? `Done · +${TASK_POINTS} points` : "Adding your Google category…"}
          </>
        ),
        launcherFg: taskFg,
        mood: mode,
      }}
      overlay={
        intro !== "done" ? (
          <Arrival
            key={introRun}
            bubble={bubble}
            onLand={onLand}
            onBubbleOff={onBubbleOff}
            onArrived={onArrived}
          />
        ) : null
      }
      demoExtra={
        <button
          type="button"
          onClick={replay}
          style={{
            height: 30,
            border: 0,
            borderRadius: 999,
            padding: "0 12px",
            background: "transparent",
            font: "700 12px Arial,sans-serif",
            color: "#a8c7fa",
            cursor: "pointer",
          }}
        >
          Replay
        </button>
      }
    >
      <HomeBody task={task} mode={mode} taskRun={taskRun} onDeviceChange={replay} />
    </HappyflowShell>
  );
}

function HomeSub() {
  const { isM } = useHf();
  return <>{isM ? "Day 1 of 30 · NORA is on it" : "One mission this month. NORA is on it."}</>;
}

function StatusIcon({ done }: { done: boolean }) {
  if (done)
    return (
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#34a853",
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
        }}
      >
        <Tick size={10} />
      </span>
    );
  return (
    <span
      style={{
        width: 14,
        height: 14,
        flexShrink: 0,
        borderRadius: "50%",
        border: "2px solid rgba(26,115,232,.2)",
        borderTopColor: "#1a73e8",
        animation: "hf-nSpin .8s linear infinite",
        display: "block",
      }}
    />
  );
}

/** NORA's arrival: flies in from the top left, says hi, settles into the launcher / bottom bar. */
function Arrival({
  bubble,
  onLand,
  onBubbleOff,
  onArrived,
}: {
  bubble: boolean;
  onLand: () => void;
  onBubbleOff: () => void;
  onArrived: () => void;
}) {
  const { isD } = useHf();
  const wrapRef = useRef<HTMLDivElement>(null);
  const flyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = flyRef.current;
    const fr = wrapRef.current;
    if (!el || !fr) return;
    const rm = prefersReducedMotion();
    const timers: ReturnType<typeof setTimeout>[] = [];
    let anim: Animation | null = null;
    const W = fr.clientWidth;
    const H = fr.clientHeight;
    const s = isD ? 64 : 52;
    const ex = isD ? W - 28 - s : W / 2 - s / 2;
    const ey = isD ? H - 28 - s : H - 12 - 66 - 8;
    const end = `translate(${ex}px,${ey}px) scale(1)`;
    const start = "translate(24px,24px) scale(.6)";

    if (!isD) {
      const cx = W / 2 - s / 2;
      const cy = H / 2 - s / 2 - 60;
      const mid = `translate(${cx}px,${cy}px) scale(1.2)`;
      const landM = () => {
        onLand();
        timers.push(
          setTimeout(() => {
            onBubbleOff();
            if (rm) {
              el.style.transform = end;
              onArrived();
              return;
            }
            anim = el.animate([{ transform: mid }, { transform: end }], {
              duration: 650,
              easing: "cubic-bezier(.5,0,.3,1)",
              fill: "forwards",
            });
            anim.onfinish = onArrived;
          }, 3000),
        );
      };
      if (rm) {
        el.style.transform = mid;
        landM();
      } else {
        anim = el.animate(
          [
            { transform: start, opacity: 0 },
            { transform: start, opacity: 1, offset: 0.12 },
            { transform: mid, opacity: 1 },
          ],
          { duration: 1500, easing: "cubic-bezier(.3,0,.2,1)", fill: "forwards" },
        );
        anim.onfinish = landM;
      }
    } else {
      const land = () => {
        onLand();
        timers.push(setTimeout(onArrived, 3400));
      };
      if (rm) {
        el.style.transform = end;
        land();
      } else {
        anim = el.animate(
          [
            { transform: start, opacity: 0 },
            {
              transform: `translate(${W * 0.3}px,${H * 0.18}px) scale(1.15)`,
              opacity: 1,
              offset: 0.3,
            },
            { transform: `translate(${W * 0.62}px,${H * 0.42}px) scale(1.3)`, offset: 0.62 },
            { transform: end },
          ],
          { duration: 2200, easing: "cubic-bezier(.45,0,.25,1)", fill: "forwards" },
        );
        anim.onfinish = land;
      }
    }
    return () => {
      timers.forEach(clearTimeout);
      if (anim) {
        anim.onfinish = null;
        anim.cancel();
      }
    };
  }, [isD, onLand, onBubbleOff, onArrived]);

  const bubblePos: CSSProperties = isD
    ? { right: "calc(100% + 14px)", top: "50%", transform: "translateY(-50%)" }
    : { top: "calc(100% + 16px)", left: "50%", transform: "translateX(-50%)" };

  return (
    <div
      ref={wrapRef}
      aria-hidden
      style={{ position: "absolute", inset: 0, zIndex: 55, pointerEvents: "none" }}
    >
      <div
        ref={flyRef}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          pointerEvents: "none",
          transform: "translate(24px,24px) scale(.6)",
          willChange: "transform",
        }}
      >
        <span
          style={{
            position: "absolute",
            inset: -14,
            borderRadius: "50%",
            background: "radial-gradient(circle,rgba(155,114,242,.4),transparent 70%)",
            animation: "hf-halo 2.4s ease-in-out infinite",
          }}
        />
        <NoraFace size={isD ? 64 : 52} mood={bubble ? "done" : "working"} shadow={FACE_SHADOW} />
        {bubble ? (
          <div style={{ position: "absolute", ...bubblePos }}>
            <div
              style={{
                width: "max-content",
                maxWidth: isD ? 260 : 190,
                borderRadius: 18,
                background: "#fff",
                padding: "12px 16px",
                boxShadow: "0 12px 32px rgba(66,133,244,.2)",
                fontSize: isD ? 15 : 13,
                lineHeight: 1.4,
                color: "#202124",
                textAlign: "center",
                animation: "hf-pop .45s cubic-bezier(.2,.8,.2,1) both",
              }}
            >
              Hi Alex. <b>I&apos;m here when you need me.</b>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const card: CSSProperties = {
  borderRadius: 22,
  background: "rgba(255,255,255,.94)",
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  boxShadow: "0 4px 12px rgba(66,133,244,.08)",
};
const kicker: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: ".12em",
  color: "#5f6368",
};
const pointer: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  border: 0,
  background: "none",
  padding: 0,
  font: "13px Arial,sans-serif",
  lineHeight: 1.4,
  color: "#202124",
  cursor: "pointer",
  textAlign: "left",
};
const tile: CSSProperties = {
  scrollSnapAlign: "start",
  border: 0,
  borderRadius: 20,
  background: "rgba(255,255,255,.95)",
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  textAlign: "left",
  cursor: "pointer",
  boxShadow: "0 4px 12px rgba(66,133,244,.08)",
};
const tileHover: CSSProperties = { boxShadow: "0 12px 32px rgba(66,133,244,.12)" };
const tileHead: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 13,
  fontWeight: 700,
  color: "#5f6368",
};
const tileRow: CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "space-between",
  gap: 10,
};
const bigNum: CSSProperties = {
  fontSize: 32,
  fontWeight: 700,
  letterSpacing: "-0.03em",
  lineHeight: 1,
  fontVariantNumeric: "tabular-nums",
};
const ofSpan: CSSProperties = { fontSize: 14, fontWeight: 400, color: "#5f6368", letterSpacing: 0 };
const link: CSSProperties = { fontSize: 12, fontWeight: 700, color: "#1a73e8" };

function HomeBody({
  task,
  mode,
  taskRun,
  onDeviceChange,
}: {
  task: Task;
  mode: NoraMood;
  taskRun: number;
  onDeviceChange: () => void;
}) {
  const hf = useHf();
  const { isD } = hf;
  const rm = useReducedMotion();
  const [plan, setPlan] = useState(true);

  // The prototype replays the arrival when the layout switches between mobile and desktop.
  const lastD = useRef(isD);
  useEffect(() => {
    if (lastD.current !== isD) {
      lastD.current = isD;
      onDeviceChange();
    }
  }, [isD, onDeviceChange]);

  const { score, done } = task;
  const youP = (score / RIVERBEND_SCORE) * 100;
  const youPct = youP.toFixed(1) + "%";
  const delta = score - SCORE_AT_CLAIM;
  const gap = RIVERBEND_SCORE - score;
  const kickFg = done ? "#137333" : "#7b4ce0";
  const showPlan = plan && done;
  const sp = (d: string, m = "1 / -1") => (isD ? d : m);
  const doneCount = done ? 10 : 9;
  const doneList = (done ? [["Added your Google category", "+6"] as [string, string]] : [])
    .concat(DONE_BEFORE)
    .slice(0, 4);
  const face = (size: number, m: NoraMood): ReactNode => (
    <NoraFace size={size} mood={m} shadow={FACE_SHADOW} burstKey={taskRun} />
  );
  const arrow = <Ic name="arrow" size={14} color="#1a73e8" sw={2.4} />;
  const swipe = (cols: string): CSSProperties =>
    isD
      ? { gridTemplateColumns: cols }
      : {
          gridAutoFlow: "column",
          overflowX: "auto",
          margin: "0 -14px",
          padding: "2px 14px 10px",
          scrollSnapType: "x mandatory",
        };

  return (
    <div
      style={{
        display: "grid",
        ...(isD
          ? { gridTemplateColumns: "repeat(12,minmax(0,1fr))", gap: 16 }
          : { gridTemplateColumns: "minmax(0,1fr)", gap: 14 }),
      }}
    >
      {/* Mission hero */}
      <section
        style={{
          gridColumn: "1 / -1",
          order: 1,
          position: "relative",
          overflow: "hidden",
          borderRadius: 28,
          backgroundImage: PEARL,
          padding: isD ? "28px 32px" : "20px 18px",
          display: "flex",
          flexDirection: isD ? "row" : "column",
          gap: 28,
          alignItems: "center",
          boxShadow: "0 12px 32px rgba(66,133,244,.12)",
          animation: "hf-rise .32s ease both",
        }}
      >
        <span
          style={{
            position: "absolute",
            inset: 0,
            overflow: "hidden",
            pointerEvents: "none",
            opacity: 0.45,
          }}
        >
          {ORBS.map(([c, l, t, dl]) => (
            <span
              key={c + l}
              style={{
                position: "absolute",
                left: l,
                top: t,
                width: 240,
                height: 240,
                borderRadius: "50%",
                background: c,
                opacity: 0.55,
                filter: "blur(64px)",
                animation: rm ? "none" : `hf-orbFloat 14s ease-in-out ${-dl}s infinite`,
              }}
            />
          ))}
        </span>
        <div
          style={{
            position: "relative",
            flex: 1,
            minWidth: 0,
            alignSelf: "stretch",
            display: "flex",
            flexDirection: "column",
            gap: 12,
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
              color: "#7b4ce0",
            }}
          >
            <Ic name="target" size={14} color="#7b4ce0" sw={2.4} />
            YOUR MISSION · DAY 1 OF 30
          </span>
          <span
            style={{
              fontSize: isD ? 36 : 26,
              fontWeight: 700,
              letterSpacing: "-0.03em",
              lineHeight: 1.1,
              textWrap: "balance",
            }}
          >
            Pass{" "}
            <span
              style={{
                background: "linear-gradient(135deg,#4285f4,#9b72f2 40%,#ea4335 75%,#fbbc04)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              Riverbend Bank &amp; Trust
            </span>
          </span>
          <span style={{ fontSize: 14, lineHeight: 1.5, color: "#5f6368" }}>
            Riverbend Bank &amp; Trust is #1 in Davenport — here&apos;s your gap. You&apos;re #6 of
            41.
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <img
                  src={PERSONA.photo}
                  alt=""
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: "50%",
                    objectFit: "cover",
                    objectPosition: PERSONA.photoPos,
                    boxShadow: "0 0 0 2px #fff,0 0 0 3.5px #1a73e8",
                  }}
                />
                <span>
                  You{" "}
                  <b style={{ color: "#1a73e8", fontVariantNumeric: "tabular-nums" }}>{score}</b>
                </span>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <span>
                  Riverbend <b style={{ fontVariantNumeric: "tabular-nums" }}>{RIVERBEND_SCORE}</b>
                </span>
                <span
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: "50%",
                    background: "#fff",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#c5221f",
                    boxShadow: "0 0 0 2px #fff,0 0 0 3.5px #f6aea9",
                  }}
                >
                  R
                </span>
              </span>
            </div>
            <div
              style={{
                position: "relative",
                height: 14,
                borderRadius: 7,
                background: "repeating-linear-gradient(135deg,#fce8e6 0 6px,#fad2cf 6px 12px)",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: youPct,
                  borderRadius: 7,
                  background: "linear-gradient(90deg,#4285f4,#9b72f2)",
                  transition: "width .8s ease",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  left: "70%",
                  top: -4,
                  bottom: -4,
                  width: 2,
                  borderRadius: 1,
                  background: "#137333",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  left: youPct,
                  top: "50%",
                  transform: "translate(-50%,-50%)",
                  display: "flex",
                  transition: "left .8s ease",
                }}
              >
                {face(24, mode)}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                fontSize: 12,
              }}
            >
              <span style={{ fontWeight: 700, color: "#137333" }}>400 · Established</span>
              <span
                style={{
                  display: "inline-block",
                  borderRadius: 999,
                  background: "#fff",
                  padding: "4px 10px",
                  fontWeight: 700,
                  color: "#c5221f",
                  boxShadow: "0 1px 3px rgba(60,64,67,.12)",
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                }}
              >
                {gap} points to #1 · I&apos;m closing it
              </span>
            </div>
          </div>
        </div>
        <div
          style={{
            position: "relative",
            flex: "none",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
          }}
        >
          <ScoreRing
            px={isD ? 196 : 190}
            ns={42}
            value={score}
            label="OF 850"
            id="hfHomeDay1Ring"
          />
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 6 }}>
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
              Building
            </span>
            <span
              style={{
                borderRadius: 999,
                background: "#e6f4ea",
                padding: "5px 12px",
                fontSize: 13,
                fontWeight: 700,
                color: "#137333",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              ▲ {delta} since you claimed
            </span>
          </div>
        </div>
      </section>

      {/* NORA's board */}
      <section
        style={{
          gridColumn: "1 / -1",
          order: 2,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          animation: "hf-rise .32s ease .06s both",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            paddingRight: 0,
          }}
        >
          <span style={{ fontSize: 18, fontWeight: 700 }}>NORA&apos;s board</span>
          <span style={{ fontSize: 13, color: "#5f6368" }}>
            What I&apos;m doing, what&apos;s next, and what needs you
          </span>
          <span
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              borderRadius: 999,
              background: "#fff",
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 700,
              boxShadow: "0 1px 3px rgba(60,64,67,.08)",
            }}
          >
            <span style={{ display: "flex", gap: 3 }}>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    border: "1.5px solid #c6dafc",
                  }}
                />
              ))}
            </span>
            0 of 3 moves this week
          </span>
        </div>
        <div
          style={{
            display: "grid",
            gap: 12,
            alignItems: "stretch",
            gridTemplateColumns: isD ? "repeat(4,minmax(0,1fr))" : "minmax(0,1fr)",
          }}
        >
          {/* Doing now → Just finished */}
          <div
            style={{
              borderRadius: 22,
              background: done ? "#e6f4ea" : "#eef3fe",
              border: `1.5px solid ${done ? "#ceead6" : "#d2e3fc"}`,
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              transition: "background .5s,border-color .5s",
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
                color: kickFg,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: kickFg,
                  animation: done ? "none" : "hf-pulseDot 1.6s ease-out infinite",
                }}
              />
              {done ? "JUST FINISHED" : "DOING NOW"}
            </span>
            <div
              style={{
                borderRadius: 16,
                background: "#fff",
                padding: 14,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                {face(28, mode)}
                <span style={{ flex: 1, fontSize: 15, fontWeight: 700, lineHeight: 1.3 }}>
                  Adding your Google category and services
                </span>
              </div>
              <div
                style={{
                  height: 6,
                  borderRadius: 3,
                  background: "rgba(26,115,232,.14)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${task.pct}%`,
                    borderRadius: 3,
                    background: done ? "#34a853" : "linear-gradient(90deg,#4285f4,#9b72f2,#4285f4)",
                    backgroundSize: "200% 100%",
                    animation: "hf-nDrift 2s ease infinite",
                    transition: "width .25s linear",
                  }}
                />
              </div>
              <b
                style={{
                  fontSize: 13,
                  color: done ? "#137333" : "#1967d2",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {done ? `Done · +${TASK_POINTS} points` : `${task.pct}%`}
              </b>
            </div>
            <button type="button" onClick={() => hf.go("srs")} style={pointer}>
              {arrow}
              <span>
                Your full gap list is in <b style={{ color: "#1a73e8" }}>SRS</b>.
              </span>
            </button>
            <button type="button" onClick={() => hf.go("insights")} style={pointer}>
              {arrow}
              <span>
                ChatGPT names you in 1 of 7 answers.{" "}
                <b style={{ color: "#1a73e8" }}>Want to see why?</b>
              </span>
            </button>
          </div>

          {/* Up next */}
          <div style={card}>
            <span style={kicker}>UP NEXT</span>
            {MOVES.map((m) => (
              <Hov
                key={m.t}
                onClick={() => hf.go(m.to)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  borderRadius: 16,
                  borderWidth: 1.5,
                  borderStyle: "solid",
                  borderColor: m.rec ? "#c6dafc" : "#eceef1",
                  background: m.rec ? "#f5f9ff" : "#fff",
                  padding: 12,
                  textAlign: "left",
                  cursor: "pointer",
                }}
                hover={{ borderColor: "#a8c7fa" }}
              >
                {m.rec ? (
                  <span
                    style={{
                      alignSelf: "flex-start",
                      borderRadius: 999,
                      background: "linear-gradient(135deg,#4285f4,#9b72f2)",
                      padding: "2px 8px",
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#fff",
                    }}
                  >
                    NORA recommends
                  </span>
                ) : null}
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 14,
                    fontWeight: 700,
                    color: "#202124",
                  }}
                >
                  <Ic name={m.icon} size={15} />
                  {m.t}
                </span>
                <span style={{ fontSize: 12, lineHeight: 1.4, color: "#5f6368" }}>{m.sub}</span>
              </Hov>
            ))}
          </div>

          {/* Needs you */}
          <div style={card}>
            <span style={kicker}>NEEDS YOU</span>
            <div
              style={{
                flex: 1,
                borderRadius: 16,
                border: "1.5px dashed #dadce0",
                padding: "20px 14px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                textAlign: "center",
              }}
            >
              {face(44, "idle")}
              <span style={{ fontSize: 15, fontWeight: 700 }}>Nothing needs you right now.</span>
              <span style={{ fontSize: 13, color: "#5f6368" }}>I&apos;m on it.</span>
            </div>
          </div>

          {/* Done */}
          <div
            style={{
              borderRadius: 22,
              background: "#e6f4ea",
              border: "1.5px solid #ceead6",
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <span style={{ ...kicker, color: "#137333" }}>DONE · {doneCount} THINGS</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span
                style={{
                  fontSize: 32,
                  fontWeight: 700,
                  letterSpacing: "-0.03em",
                  lineHeight: 1,
                  color: "#137333",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                +{delta}
              </span>
              <span style={{ fontSize: 13, color: "#137333" }}>points since you claimed</span>
            </div>
            <svg viewBox="0 0 300 70" style={{ width: "100%", height: "auto" }} aria-hidden>
              <line
                x1={0}
                x2={300}
                y1={10}
                y2={10}
                stroke="#34a853"
                strokeWidth={1.2}
                strokeDasharray="4 4"
              />
              <path
                d="M6 60 L90 30 L150 21 L220 15 L294 12"
                fill="none"
                stroke="#1e8e3e"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx={294} cy={12} r={4.5} fill="#1e8e3e" stroke="#fff" strokeWidth={2} />
            </svg>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {doneList.map(([t, pts]) => (
                <div
                  key={t}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 13,
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
                  <span style={{ flex: 1, minWidth: 0 }}>{t}</span>
                  {pts ? <b style={{ fontSize: 12, color: "#137333" }}>{pts}</b> : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Tiles */}
      <section
        style={{
          gridColumn: "1 / -1",
          order: 3,
          display: "grid",
          gap: 12,
          ...swipe("repeat(4,minmax(0,1fr))"),
          ...(isD ? {} : { gridAutoColumns: 172 }),
        }}
      >
        <Hov
          onClick={() => hf.go("insights")}
          style={{ ...tile, animation: "hf-rise .32s ease .1s both" }}
          hover={tileHover}
        >
          <span style={tileHead}>
            <Ic name="pin" size={15} color="#1a73e8" />
            Top-3 map spots
          </span>
          <div style={tileRow}>
            <span style={bigNum}>
              9 <span style={ofSpan}>of 49</span>
            </span>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7,7px)",
                gap: 2,
                flex: "none",
              }}
            >
              {MINI.map((g) => (
                <span
                  key={g.i}
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 2,
                    background: g.bg,
                    boxShadow: g.sh,
                  }}
                />
              ))}
            </div>
          </div>
          <span style={link}>See the map →</span>
        </Hov>
        <Hov
          onClick={() => hf.go("insights")}
          style={{ ...tile, animation: "hf-rise .32s ease .14s both" }}
          hover={tileHover}
        >
          <span style={tileHead}>
            <Ic name="spark" size={15} color="#9b72f2" />
            AI citations
          </span>
          <div style={tileRow}>
            <span style={bigNum}>
              1 <span style={ofSpan}>of 7</span>
            </span>
            <span style={{ display: "flex", gap: 3, paddingBottom: 4 }}>
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <span
                  key={i}
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    background: i === 0 ? "#9b72f2" : "#eceef1",
                  }}
                />
              ))}
            </span>
          </div>
          <span style={link}>Want to see why? →</span>
        </Hov>
        <Hov
          onClick={() => hf.go("reviews")}
          style={{ ...tile, animation: "hf-rise .32s ease .18s both" }}
          hover={tileHover}
        >
          <span style={tileHead}>
            <Ic name="star" size={15} color="#f9ab00" />
            Reviews
          </span>
          <div style={tileRow}>
            <span style={bigNum}>4.9</span>
            <span style={{ fontSize: 14, letterSpacing: 1, color: "#f9ab00", paddingBottom: 4 }}>
              ★★★★★
            </span>
          </div>
          <span style={{ fontSize: 12, color: "#5f6368" }}>from 128 reviews</span>
        </Hov>
        <Hov
          onClick={() => hf.go("profile")}
          style={{ ...tile, animation: "hf-rise .32s ease .22s both" }}
          hover={tileHover}
        >
          <span style={tileHead}>
            <Ic name="user" size={15} color="#1a73e8" />
            Profile strength
          </span>
          <span style={bigNum}>64%</span>
          <div style={{ height: 6, borderRadius: 3, background: "#eceef1", overflow: "hidden" }}>
            <div
              style={{
                width: "64%",
                height: "100%",
                borderRadius: 3,
                background: "linear-gradient(90deg,#4285f4,#9b72f2)",
              }}
            />
          </div>
        </Hov>
      </section>

      {/* Locked: what NORA found behind your plan */}
      <section
        style={{
          gridColumn: sp(showPlan ? "span 8" : "1 / -1"),
          order: 4,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          animation: "hf-rise .32s ease .16s both",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>What NORA found behind your plan</span>
          <b style={{ marginLeft: "auto", fontSize: 12, color: "#b06000", whiteSpace: "nowrap" }}>
            127 points waiting
          </b>
        </div>
        <div
          style={{
            display: "grid",
            gap: 10,
            ...swipe("repeat(3,minmax(0,1fr))"),
            ...(isD ? {} : { gridAutoColumns: 260 }),
          }}
        >
          {LOCKED.map((l) => (
            <Hov
              key={l.t}
              onClick={() => hf.out("Billing")}
              style={{
                scrollSnapAlign: "start",
                borderWidth: 1,
                borderStyle: "solid",
                borderColor: "#fbe3a4",
                borderRadius: 18,
                background: "#fef7e0",
                padding: 14,
                display: "flex",
                flexDirection: "column",
                gap: 8,
                textAlign: "left",
                cursor: "pointer",
              }}
              hover={{ borderColor: "#f9ab00" }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    width: 28,
                    height: 28,
                    flex: "none",
                    borderRadius: "50%",
                    background: "#fff",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  <Ic name="lock" size={14} color="#b06000" sw={2.4} />
                </span>
                <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: "#202124" }}>
                  {l.t}
                </span>
                {l.pts ? (
                  <b
                    style={{
                      borderRadius: 999,
                      background: "#fff",
                      padding: "2px 8px",
                      fontSize: 12,
                      color: "#b06000",
                    }}
                  >
                    {l.pts}
                  </b>
                ) : null}
              </span>
              <span style={{ fontSize: 13, lineHeight: 1.45, color: "#5f6368" }}>{l.d}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#b06000" }}>Unlock →</span>
            </Hov>
          ))}
        </div>
      </section>

      {/* Plan card — only after the first task shows Done (spec fix). */}
      {showPlan ? (
        <section
          style={{
            gridColumn: sp("span 4"),
            order: 5,
            borderRadius: 24,
            background: "rgba(255,255,255,.94)",
            padding: 18,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            boxShadow: "0 4px 12px rgba(66,133,244,.08)",
            animation: "hf-rise .32s ease .24s both",
          }}
        >
          <span style={kicker}>LOAN OFFICERS LIKE YOU ON AMPLIFY</span>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span
              style={{
                fontSize: 36,
                fontWeight: 700,
                letterSpacing: "-0.03em",
                lineHeight: 1,
                color: "#137333",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              +61
            </span>
            <span style={{ fontSize: 13, color: "#5f6368" }}>median points in 90 days</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <span style={{ display: "flex", gap: 4 }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    background: i < 3 ? "#34a853" : "#e6f4ea",
                  }}
                />
              ))}
            </span>
            3 of 5 reached the next band.
          </div>
          <span style={{ fontSize: 11, lineHeight: 1.4, color: "#80868b" }}>
            Based on 34 loan officers who started at Building, Jan–Sep 2026.
          </span>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <Hov
              onClick={() => hf.out("Billing")}
              style={{
                flex: 1,
                height: 42,
                border: 0,
                borderRadius: 12,
                background: "#1a73e8",
                font: "700 14px Arial,sans-serif",
                color: "#fff",
                cursor: "pointer",
              }}
              hover={{ background: "#1557b0" }}
            >
              Compare plans
            </Hov>
            <button
              type="button"
              onClick={() => setPlan(false)}
              style={{
                height: 42,
                border: "1px solid #dadce0",
                borderRadius: 12,
                background: "#fff",
                padding: "0 16px",
                font: "700 14px Arial,sans-serif",
                color: "#3c4043",
                cursor: "pointer",
              }}
            >
              Not now
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
