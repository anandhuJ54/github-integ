/**
 * HappyflowShell — the SRP app frame from the Happyflow prototype: desktop sidebar (240 px),
 * mobile floating bottom bar + "More" sheet, page header, the NORA launcher and NORA window
 * (chat, "What I can use", VOCE, upgrade, day-24 recap), the edit sheet, the toast and the
 * prototype's demo controls (Restart flow · Day 1/7/24 · screen picker · Mobile/Desktop).
 *
 * Screens render inside it and reach shared behaviour through `useHf()`.
 */
import "./happyflow.css";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { HF_EMBED_HEIGHT, useHfNav } from "./seat-nav";
import { DANA, GRID, HF_ASSETS, SCORE_BY_DAY, parseBold, type HfDay } from "./demo-data";
import {
  Hov,
  Ic,
  NoraFace,
  PAGE_WASH,
  RIBBON,
  Tick,
  prefersReducedMotion,
  type NoraMood,
  ProBadge,
} from "./primitives";
import type { HfIconName } from "./icons";
import { useHfDevice } from "./use-hf-device";
import { useSpeech } from "./use-speech";

export type HfScreen =
  "home" | "srs" | "profile" | "insights" | "website" | "connections" | "network" | "settings";

/** Everywhere the demo can go. */
export type HfTarget =
  HfScreen | "day7" | "events" | "recap" | "find" | "interview" | "chat" | "voce" | "reviews";

export type NoraWin = "talk" | "uses" | "voce" | "upgrade" | "recap" | "plans" | null;

/**
 * The NORA chat UI (floating launcher, chat window, mobile NORA tab, arrival flyer) is switched off:
 * the NORA OS team ships the package that injects gaps and issues. Flip to true to bring it back.
 */
export const HF_NORA_UI = false;

/**
 * The prototype's demo control bar (Restart flow · Day 1/7/24 · screen picker · Mobile/Desktop) is
 * hidden for now. Flip to true to bring it back; the code is unchanged.
 */
export const HF_DEMO_BAR = false;

export type HfSheet = {
  title: string;
  body?: string;
  input?: boolean;
  ph?: string;
  cta: string;
  /** NORA's note under the input; omit for none. */
  nora?: string;
  /** Custom body (e.g. a review list); it renders its own actions when `hideCta` is set. */
  content?: ReactNode;
  hideCta?: boolean;
  /** Toast shown after the primary button. */
  done?: string;
  onSave?: (value: string) => void;
  /** Start voice dictation as soon as the sheet opens. */
  voice?: boolean;
  /** Individual fields, each typed or dictated (mic per field). */
  fields?: SheetField[];
  /** Called on save with every field's value and the free-text box (if `input`). */
  onSaveFields?: (values: Record<string, string>, text: string) => void;
};

export type SheetField = { key: string; label: string; value: string; ph?: string };

export type HfAct = HfTarget | "close" | ((api: HfApi) => void);

export type Think = { t: string; d: string; cta: string; act: HfAct };

export type HfApi = {
  isD: boolean;
  isM: boolean;
  w: number;
  day: HfDay;
  score: number;
  toast: (msg: string) => void;
  /** Toast for screens the prototype does not build ("Opens Billing, compare plans · screen 17"). */
  out: (label: string) => void;
  go: (to: HfTarget) => void;
  run: (a: HfAct) => void;
  win: NoraWin;
  openNora: (w?: Exclude<NoraWin, null>) => void;
  closeNora: () => void;
  ask: (q: string) => void;
  openSheet: (sheet: HfSheet, value?: string) => void;
  closeSheet: () => void;
  connected: Record<string, boolean>;
  connect: (name: string) => void;
};

const HfCtx = createContext<HfApi | null>(null);

export function useHf(): HfApi {
  const v = useContext(HfCtx);
  if (!v) throw new Error("useHf must be used inside <HappyflowShell>");
  return v;
}

const OUT: Record<string, string> = {
  Listings: "Listings · screen 11",
  Billing: "Billing, compare plans · screen 17",
};

const MORE: {
  label: string;
  icon: HfIconName;
  locked?: boolean;
  pro?: boolean;
  to: HfTarget | "Listings";
}[] = [
  { label: "SRS", icon: "gauge", to: "srs" },
  { label: "Website Analytics", icon: "globe", pro: true, to: "website" },
  { label: "Connections", icon: "plug", to: "connections" },
  { label: "Network", icon: "users", to: "network" },
  { label: "Listings", icon: "list", locked: true, to: "Listings" },
  { label: "Reviews", icon: "star", locked: true, to: "reviews" },
  { label: "Settings", icon: "sliders", to: "settings" },
];

const PICKS: [HfTarget, string][] = [
  ["find", "1–2 · Find you / Claim"],
  ["interview", "3 · Interview"],
  ["home", "4 · Home"],
  ["chat", "5 · NORA chat"],
  ["srs", "6 · SRS"],
  ["profile", "7 · Profile"],
  ["connections", "8 · Connections"],
  ["website", "9 · Website Analytics"],
  ["insights", "10 · Insights"],
  ["day7", "13 · Home, day 7"],
  ["events", "14 · Event pop-ups"],
  ["voce", "15 · VOCE"],
  ["recap", "16 · Day 24 recap"],
  ["network", "18 · Network"],
  ["settings", "19 · Settings"],
];

const ANSWERS: Record<
  string,
  { t: string; map?: "river" | "you"; acts?: [string, HfAct, boolean?][] }
> = {
  "Where am I losing to Riverbend?": {
    t: "Three places: they have **412 reviews** to your 128, **14 articles** to your 0, and markup on their website that yours lacks.",
    map: "river",
    acts: [
      ["Start publishing", "voce", true],
      ["Fix my website", "website"],
    ],
  },
  "What should I fix first?": {
    t: "**Articles.** 85 points are open there, and you only need 10 to reach Established.",
    acts: [
      ["Start publishing", "voce", true],
      ["Open SRS", "srs"],
    ],
  },
  "Write my first article": {
    t: "Let's do it. You offer **VA loans** but have nothing written about them — I'll draft that one first.",
    acts: [["Start publishing", "voce", true]],
  },
  "Why is my score 390?": {
    t: "You've earned **390 of 850**. The biggest lanes still open are Articles (85), Website + schema (62) and Completeness (55).",
    acts: [["Open SRS", "srs", true]],
  },
  "Show my map": {
    t: "You're top 3 in **9 of 49** spots around 100 Main St. Riverbend is above you in 34.",
    map: "you",
    acts: [["Open Insights", "insights", true]],
  },
};

type Msg =
  | { me: true; t: string }
  | { me: false; t: string; map?: "river" | "you"; acts?: [string, HfAct, boolean?][] };

const RIVER_CELLS = GRID.map((g) => (g.k < 15 ? "#c6dafc" : "#ea4335"));
const YOU_CELLS = GRID.map((g) => (g.i === 24 ? "#1a73e8" : g.bg));

const btnReset: CSSProperties = { border: 0, cursor: "pointer" };

export type HappyflowShellProps = {
  screen: HfScreen;
  day?: HfDay;
  title: ReactNode;
  sub: ReactNode;
  /** Home layout: avatar on mobile instead of Back, "Day N of 30" chip on desktop. */
  home?: boolean;
  /** Extra controls on the right of the header (e.g. SRS "How it's calculated"). */
  headerRight?: ReactNode;
  /** Event pop-up / banner shown under the header. */
  banner?: ReactNode;
  /** NORA panel content for this page. */
  nora?: {
    status?: string;
    greeting?: ReactNode;
    intro?: ReactNode;
    thinks?: Think[];
    outro?: ReactNode;
    chips?: string[];
    launcherText?: ReactNode;
    launcherFg?: string;
    /** Hide the "What I can use" button. */
    noUses?: boolean;
    /** Mood of the launcher / bottom-bar NORA and the panel status dot (follows the page's task). */
    mood?: NoraMood;
  };
  /** Hide the floating launcher (e.g. while NORA's arrival animation runs). */
  hideLauncher?: boolean;
  /** Open this NORA window on mount (deep links: chat, VOCE, recap). */
  initialWin?: NoraWin;
  /** Extra absolutely-positioned layers inside the frame (arrival flyer, dialogs). */
  overlay?: ReactNode | ((api: HfApi) => ReactNode);
  /** Extra buttons in the demo control bar. */
  demoExtra?: ReactNode;
  children: ReactNode;
};

export function HappyflowShell(props: HappyflowShellProps) {
  const { screen, day = 1, home = false } = props;
  const { w, isD, isM, framed, setDev } = useHfDevice();
  const hfNav = useHfNav();
  const score = SCORE_BY_DAY[day];

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [win, setWin] = useState<NoraWin>(props.initialWin ?? null);
  const [more, setMore] = useState(false);
  const [planHidden, setPlanHidden] = useState(false);
  const [sheet, setSheet] = useState<HfSheet | null>(null);
  const [sheetVal, setSheetVal] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [typing, setTyping] = useState(false);
  const [voce, setVoce] = useState<1 | 2 | 3>(1);
  const [voceBusy, setVoceBusy] = useState(false);
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const [uses, setUses] = useState<Record<string, boolean>>({
    "Google Business Profile": true,
    Website: true,
    LinkedIn: true,
    Facebook: true,
    Zillow: true,
  });
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const t = timers.current;
    return () => {
      t.forEach(clearTimeout);
      if (toastT.current) clearTimeout(toastT.current);
    };
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    if (toastT.current) clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToastMsg(null), 2400);
  }, []);

  const out = useCallback(
    (label: string) => {
      if (label === "Billing") setWin("plans");
      else toast("Opens " + (OUT[label] || label));
    },
    [toast],
  );

  const openNora = useCallback((m: Exclude<NoraWin, null> = "talk") => {
    if (!HF_NORA_UI && (m === "talk" || m === "uses")) return;
    if (m === "voce") {
      setVoce(1);
      setVoceBusy(false);
    }
    setWin(m);
  }, []);

  const go = useCallback(
    (to: HfTarget) => {
      if (to === "chat") {
        if (!HF_NORA_UI) return toast("NORA picks this up once the NORA OS package is connected");
        return openNora("talk");
      }
      if (to === "voce") return openNora("voce");
      hfNav(to === "home" && day >= 7 ? "day7" : to);
    },
    [day, hfNav, openNora, toast],
  );

  // Dictation goes to the free-text box ("") or to one field of a multi-field sheet.
  const [sheetFields, setSheetFields] = useState<Record<string, string>>({});
  const voiceTarget = useRef("");
  const [voiceKey, setVoiceKey] = useState("");
  const speech = useSpeech((t) => {
    const k = voiceTarget.current;
    if (k) setSheetFields((x) => ({ ...x, [k]: t }));
    else setSheetVal(t);
  });
  const { start: startVoice, stop: stopVoice } = speech;
  const dictate = useCallback(
    (key: string, base: string) => {
      voiceTarget.current = key;
      setVoiceKey(key);
      startVoice(base);
    },
    [startVoice],
  );
  const openSheet = useCallback(
    (s: HfSheet, value = "") => {
      setWin(null);
      setSheet(s);
      setSheetVal(value);
      setSheetFields(Object.fromEntries((s.fields ?? []).map((f) => [f.key, f.value])));
      if (s.voice) dictate("", value);
    },
    [dictate],
  );
  const freeListening = speech.listening && voiceKey === "";
  const closeSheet = useCallback(() => {
    stopVoice();
    setSheet(null);
  }, [stopVoice]);

  const connect = useCallback(
    (n: string) => {
      setConnected((c) => ({ ...c, [n]: true }));
      setWin(null);
      toast(`${n} connected · I'll start using it`);
    },
    [toast],
  );

  const scrollChat = useCallback(() => {
    requestAnimationFrame(() => {
      const el = bodyRef.current;
      if (el)
        el.scrollTo({ top: el.scrollHeight, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    });
  }, []);

  const ask = useCallback(
    (raw: string) => {
      const q = (raw || "").trim();
      if (!q) return;
      if (!HF_NORA_UI) return;
      setWin("talk");
      setMsgs((m) => m.concat({ me: true, t: q }));
      setTyping(true);
      scrollChat();
      later(
        () => {
          const a = ANSWERS[q] || {
            t: "I'll look into that and come back with a card you can act on.",
          };
          setTyping(false);
          setMsgs((m) => m.concat({ me: false, ...a }));
          scrollChat();
        },
        prefersReducedMotion() ? 200 : 1100,
      );
    },
    [later, scrollChat],
  );

  const apiRef = useRef<HfApi | null>(null);
  const run = useCallback(
    (a: HfAct) => {
      if (typeof a === "function") {
        if (apiRef.current) a(apiRef.current);
        return;
      }
      if (a === "close") {
        setWin(null);
        return;
      }
      if (a !== "chat" && a !== "voce") setWin(null);
      go(a);
    },
    [go],
  );

  const api = useMemo<HfApi>(
    () => ({
      isD,
      isM,
      w,
      day,
      score,
      toast,
      out,
      go,
      run,
      win,
      openNora,
      closeNora: () => setWin(null),
      ask,
      openSheet,
      closeSheet,
      connected,
      connect,
    }),
    [
      isD,
      isM,
      w,
      day,
      score,
      toast,
      out,
      go,
      run,
      win,
      openNora,
      ask,
      openSheet,
      closeSheet,
      connected,
      connect,
    ],
  );
  apiRef.current = api;

  const navTo = (to: HfTarget | "Listings") => (to === "Listings" ? out("Listings") : go(to));

  const voceStep = (fn: () => void, ms: number) => {
    setVoceBusy(true);
    later(
      () => {
        setVoceBusy(false);
        fn();
      },
      prefersReducedMotion() ? 50 : ms,
    );
  };

  const ctr = (dw: number, dh: number): CSSProperties =>
    isD
      ? {
          left: "50%",
          top: "50%",
          width: `min(${dw}px,calc(100% - 48px))`,
          height: `min(${dh}px,calc(100% - 48px))`,
          transform: "translate(-50%,-50%)",
          animation: "hf-modalIn .32s cubic-bezier(.2,.8,.2,1) both",
        }
      : {
          left: 12,
          right: 12,
          top: "50%",
          height: "min(88%,740px)",
          transform: "translateY(-50%)",
          animation: "hf-modalInM .32s cubic-bezier(.2,.8,.2,1) both",
        };

  const nora = props.nora ?? {};
  const chips =
    nora.chips ??
    (day >= 7
      ? ["What did you do this week?", "Fix my website", "Show my map"]
      : [
          "Where am I losing to Riverbend?",
          "What should I fix first?",
          "Write my first article",
          "Why is my score 390?",
          "Show my map",
        ]);
  const thinks = nora.thinks ?? [];
  const W = win;
  const launcherOn = HF_NORA_UI && isD && !W && !sheet && !props.hideLauncher;
  const showSwitch = HF_DEMO_BAR && (isD || framed);

  const overlay = typeof props.overlay === "function" ? props.overlay(api) : props.overlay;

  return (
    <HfCtx.Provider value={api}>
      <div
        className="hf-root"
        style={{
          background: framed ? "#e8eaed" : "transparent",
          borderRadius: framed ? 24 : 0,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          padding: framed ? "16px 0 64px" : 0,
        }}
      >
        {showSwitch ? (
          <DemoBar
            day={day}
            isD={isD}
            isM={isM}
            current={screen}
            showEvents={home && day === 7}
            onRestart={() => go("find")}
            onDay={(n) => go(n === 1 ? "home" : n === 7 ? "day7" : "recap")}
            onPick={(t) => run(t)}
            onDevice={setDev}
            extra={props.demoExtra}
          />
        ) : null}

        <div
          style={{
            position: "relative",
            width: framed ? 390 : "100%",
            height: framed ? "min(844px, calc(100vh - 80px))" : HF_EMBED_HEIGHT,
            borderRadius: framed ? 32 : 0,
            boxShadow: framed ? "0 20px 60px rgba(32,33,36,.22), 0 0 0 1px #dadce0" : "none",
            overflow: "hidden",
            display: "flex",
            // Inside the seat the page sits on the seat's own background; the wash only shows in the phone frame.
            backgroundColor: framed ? "#f7f8fc" : "transparent",
            backgroundImage: framed ? PAGE_WASH : "none",
          }}
        >
          <div
            className="hf-noscrollbar"
            style={{
              flex: 1,
              minWidth: 0,
              height: "100%",
              overflow: "auto",
              filter: W === "recap" ? "blur(2px)" : undefined,
            }}
          >
            <div
              style={{
                // Inside the seat the page body already pads 32px; the phone frame keeps its own inset.
                maxWidth: framed ? 1180 : "none",
                margin: "0 auto",
                padding: framed ? "16px 14px 110px" : isD ? "0 0 120px" : "0 0 110px",
                display: "flex",
                flexDirection: "column",
                gap: isD ? 18 : 14,
              }}
            >
              <header style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {isM && !home ? (
                  <button
                    type="button"
                    onClick={() => go("home")}
                    aria-label="Back"
                    style={{
                      ...btnReset,
                      width: 40,
                      height: 40,
                      flex: "none",
                      borderRadius: "50%",
                      background: "#fff",
                      display: "grid",
                      placeItems: "center",
                      color: "#3c4043",
                      boxShadow: "0 1px 3px rgba(60,64,67,.08)",
                    }}
                  >
                    <Ic name="back" size={20} />
                  </button>
                ) : null}
                {isM && home ? (
                  <img
                    src={DANA.photo}
                    alt=""
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: "50%",
                      objectFit: "cover",
                      objectPosition: DANA.photoPos,
                      flex: "none",
                      boxShadow: "0 0 0 2px #fff,0 0 0 3px #e8eaed",
                    }}
                  />
                ) : null}
                <div
                  style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}
                >
                  <span
                    style={{
                      fontSize: isD ? 28 : 20,
                      fontWeight: 700,
                      letterSpacing: "-0.02em",
                      lineHeight: 1.15,
                      whiteSpace: home ? "nowrap" : undefined,
                      overflow: home ? "hidden" : undefined,
                      textOverflow: home ? "ellipsis" : undefined,
                    }}
                  >
                    {props.title}
                  </span>
                  <span style={{ fontSize: isD ? 14 : 12, color: "#5f6368", lineHeight: 1.35 }}>
                    {props.sub}
                  </span>
                </div>
                {props.headerRight}
                {home && isD ? (
                  <span
                    style={{
                      flex: "none",
                      borderRadius: 999,
                      background: "#e8f0fe",
                      padding: "6px 12px",
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#1967d2",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Day {day} of 30
                  </span>
                ) : null}
              </header>

              {!planHidden ? (
                <PlanBanner
                  day={day}
                  onCompare={() => setWin("plans")}
                  onClose={() => setPlanHidden(true)}
                />
              ) : null}

              {props.banner}

              {props.children}
            </div>
          </div>

          {launcherOn ? (
            <div
              style={{
                position: "absolute",
                right: 28,
                bottom: 28,
                zIndex: 30,
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <button
                type="button"
                onClick={() => openNora("talk")}
                style={{
                  ...btnReset,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  borderRadius: 999,
                  background: "#fff",
                  padding: "10px 16px",
                  font: "700 13px Arial,sans-serif",
                  color: nora.launcherFg ?? "#1967d2",
                  boxShadow: "0 12px 32px rgba(66,133,244,.16)",
                  whiteSpace: "nowrap",
                  animation: "hf-rise .32s ease both",
                }}
              >
                {nora.launcherText ?? "Ask NORA"}
              </button>
              <button
                type="button"
                onClick={() => openNora("talk")}
                aria-label="Open NORA"
                style={{
                  ...btnReset,
                  position: "relative",
                  width: 64,
                  height: 64,
                  background: "none",
                  padding: 0,
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    inset: -8,
                    borderRadius: "50%",
                    background: "radial-gradient(circle,rgba(155,114,242,.35),transparent 70%)",
                    animation: "hf-halo 3.5s ease-in-out infinite",
                  }}
                />
                <NoraFace size={60} mood={nora.mood} />
              </button>
            </div>
          ) : null}

          {isM && framed ? (
            <MobileNav
              screen={screen}
              onHome={() => go("home")}
              onInsights={() => go("insights")}
              onNora={() => openNora("talk")}
              onProfile={() => go("profile")}
              onMore={() => setMore(true)}
              noraMood={nora.mood}
              hideNora={props.hideLauncher}
            />
          ) : null}

          {more ? (
            <>
              <div
                onClick={() => setMore(false)}
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 44,
                  background: "rgba(32,33,36,.28)",
                  backdropFilter: "blur(8px)",
                  WebkitBackdropFilter: "blur(8px)",
                  animation: "hf-fadeIn .2s ease both",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: 12,
                  right: 12,
                  bottom: 90,
                  zIndex: 45,
                  borderRadius: 24,
                  background: "#fff",
                  padding: 10,
                  display: "grid",
                  gridTemplateColumns: "repeat(2,minmax(0,1fr))",
                  gap: 4,
                  boxShadow: "0 20px 50px rgba(20,28,48,.25)",
                  animation: "hf-rise .25s ease both",
                }}
              >
                {MORE.map((m) => (
                  <button
                    type="button"
                    key={m.label}
                    onClick={() => {
                      setMore(false);
                      navTo(m.to);
                    }}
                    style={{
                      ...btnReset,
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      height: 48,
                      borderRadius: 14,
                      background: "#f8f9fb",
                      padding: "0 12px",
                      font: "600 14px Arial,sans-serif",
                      color: "#202124",
                      textAlign: "left",
                    }}
                  >
                    <Ic name={m.icon} size={18} color="#5f6368" />
                    <span style={{ flex: 1 }}>{m.label}</span>
                    {m.pro ? <ProBadge size="sm" /> : null}
                    {m.locked ? <Ic name="lock" size={14} color="#b06000" /> : null}
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {sheet ? (
            <>
              <div
                onClick={closeSheet}
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 46,
                  background: "rgba(32,33,36,.28)",
                  backdropFilter: "blur(10px)",
                  WebkitBackdropFilter: "blur(10px)",
                  animation: "hf-fadeIn .2s ease both",
                }}
              />
              <div
                role="dialog"
                aria-label={sheet.title}
                style={{
                  position: "absolute",
                  zIndex: 47,
                  borderRadius: 24,
                  background: "#fff",
                  padding: 20,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  maxHeight: "calc(100% - 32px)",
                  overflow: "auto",
                  boxShadow: "0 30px 80px rgba(20,28,48,.32)",
                  ...(isD
                    ? {
                        left: "50%",
                        top: "50%",
                        width: "min(480px,calc(100% - 48px))",
                        transform: "translate(-50%,-50%)",
                        animation: "hf-modalIn .3s cubic-bezier(.2,.8,.2,1) both",
                      }
                    : {
                        left: 12,
                        right: 12,
                        top: "50%",
                        transform: "translateY(-50%)",
                        animation: "hf-modalInM .3s cubic-bezier(.2,.8,.2,1) both",
                      }),
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ flex: 1, fontSize: 18, fontWeight: 700 }}>{sheet.title}</span>
                  <CloseBtn onClick={closeSheet} size={34} />
                </div>
                {sheet.body ? (
                  <span style={{ fontSize: 14, lineHeight: 1.5, color: "#3c4043" }}>
                    {sheet.body}
                  </span>
                ) : null}
                {sheet.input ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ position: "relative" }}>
                      <textarea
                        value={sheetVal}
                        onChange={(e) => setSheetVal(e.target.value)}
                        placeholder={freeListening ? "Listening…" : (sheet.ph ?? "")}
                        rows={sheet.voice ? 3 : 2}
                        style={{
                          width: "100%",
                          minHeight: 48,
                          resize: "vertical",
                          border: `1.5px solid ${freeListening ? "#ea4335" : "#dadce0"}`,
                          borderRadius: 14,
                          padding: speech.supported ? "13px 52px 13px 14px" : "13px 14px",
                          font: "15px/1.45 Arial,sans-serif",
                          color: "#202124",
                          outline: "none",
                        }}
                      />
                      {speech.supported ? (
                        <button
                          type="button"
                          onClick={() => (freeListening ? speech.stop() : dictate("", sheetVal))}
                          aria-label={
                            freeListening ? "Stop voice input" : "Speak instead of typing"
                          }
                          aria-pressed={freeListening}
                          style={{
                            ...btnReset,
                            position: "absolute",
                            right: 8,
                            top: 8,
                            width: 36,
                            height: 36,
                            borderRadius: "50%",
                            background: freeListening ? "#ea4335" : "#e8f0fe",
                            color: freeListening ? "#fff" : "#1a73e8",
                            display: "grid",
                            placeItems: "center",
                            animation: freeListening
                              ? "hf-pulseDot 1.2s ease-out infinite"
                              : "none",
                          }}
                        >
                          <Ic name="mic" size={18} color={freeListening ? "#fff" : "#1a73e8"} />
                        </button>
                      ) : null}
                      {sheet.fields?.length ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          {sheet.fields.map((fd) => {
                            const on = speech.listening && voiceKey === fd.key;
                            return (
                              <label
                                key={fd.key}
                                style={{ display: "flex", flexDirection: "column", gap: 4 }}
                              >
                                <span style={{ fontSize: 12, fontWeight: 700, color: "#5f6368" }}>
                                  {fd.label}
                                </span>
                                <span style={{ position: "relative", display: "block" }}>
                                  <input
                                    value={sheetFields[fd.key] ?? ""}
                                    onChange={(e) =>
                                      setSheetFields((x) => ({ ...x, [fd.key]: e.target.value }))
                                    }
                                    placeholder={on ? "Listening…" : (fd.ph ?? "")}
                                    style={{
                                      width: "100%",
                                      height: 44,
                                      border: `1.5px solid ${on ? "#ea4335" : "#dadce0"}`,
                                      borderRadius: 12,
                                      padding: speech.supported ? "0 48px 0 12px" : "0 12px",
                                      font: "15px Arial,sans-serif",
                                      color: "#202124",
                                      outline: "none",
                                    }}
                                  />
                                  {speech.supported ? (
                                    <button
                                      type="button"
                                      onClick={() => (on ? speech.stop() : dictate(fd.key, ""))}
                                      aria-label={
                                        on ? `Stop voice input for ${fd.label}` : `Say ${fd.label}`
                                      }
                                      aria-pressed={on}
                                      style={{
                                        ...btnReset,
                                        position: "absolute",
                                        right: 6,
                                        top: 6,
                                        width: 32,
                                        height: 32,
                                        borderRadius: "50%",
                                        background: on ? "#ea4335" : "#e8f0fe",
                                        display: "grid",
                                        placeItems: "center",
                                        animation: on
                                          ? "hf-pulseDot 1.2s ease-out infinite"
                                          : "none",
                                      }}
                                    >
                                      <Ic name="mic" size={16} color={on ? "#fff" : "#1a73e8"} />
                                    </button>
                                  ) : null}
                                </span>
                              </label>
                            );
                          })}
                          {speech.error && voiceKey ? (
                            <span style={{ fontSize: 12, color: "#b06000" }}>{speech.error}</span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    {speech.listening ? (
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#c5221f" }}>
                        Listening… speak naturally, tap the mic when you're done.
                      </span>
                    ) : speech.error ? (
                      <span style={{ fontSize: 12, color: "#b06000" }}>{speech.error}</span>
                    ) : speech.supported ? (
                      <span style={{ fontSize: 12, color: "#80868b" }}>
                        Tap the mic to speak instead of typing.
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {sheet.content}
                {sheet.nora ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      borderRadius: 14,
                      background: "#eef3fe",
                      padding: "10px 12px",
                    }}
                  >
                    <NoraFace size={26} />
                    <span style={{ fontSize: 13, lineHeight: 1.45, color: "#1967d2" }}>
                      {sheet.nora}
                    </span>
                  </div>
                ) : null}
                {sheet.hideCta ? null : (
                  <button
                    type="button"
                    onClick={() => {
                      const s = sheet;
                      closeSheet();
                      s.onSave?.(sheetVal);
                      s.onSaveFields?.(sheetFields, sheetVal);
                      if (s.done) toast(s.done);
                    }}
                    style={{
                      ...btnReset,
                      height: 46,
                      borderRadius: 14,
                      background: "#1a73e8",
                      font: "700 15px Arial,sans-serif",
                      color: "#fff",
                    }}
                  >
                    {sheet.cta}
                  </button>
                )}
              </div>
            </>
          ) : null}

          {W ? (
            <>
              <div
                onClick={() => setWin(null)}
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
                aria-label="NORA"
                style={{
                  position: "absolute",
                  zIndex: 41,
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                  borderRadius: 28,
                  background: "rgba(255,255,255,.98)",
                  boxShadow: "0 30px 80px rgba(20,28,48,.32)",
                  ...(W === "recap"
                    ? ctr(860, 820)
                    : W === "plans"
                      ? ctr(880, 720)
                      : W === "upgrade"
                        ? ctr(560, 520)
                        : ctr(760, 760)),
                }}
              >
                <div
                  style={{
                    height: 3,
                    flex: "none",
                    background: RIBBON,
                    backgroundSize: "200% 100%",
                    animation: "hf-nDrift 10s ease infinite",
                  }}
                />
                <div
                  style={{
                    flex: "none",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "16px 18px 10px",
                  }}
                >
                  {W === "plans" ? (
                    <span
                      style={{
                        width: 44,
                        height: 44,
                        flex: "none",
                        borderRadius: 14,
                        background: "#fef7e0",
                        display: "grid",
                        placeItems: "center",
                      }}
                    >
                      <Ic name="lock" size={20} color="#b06000" sw={2.4} />
                    </span>
                  ) : (
                    <NoraFace
                      size={44}
                      mood={
                        typing || voceBusy
                          ? "working"
                          : W === "voce" && voce === 3
                            ? "done"
                            : "idle"
                      }
                    />
                  )}
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                    }}
                  >
                    <span style={{ fontSize: 17, fontWeight: 700 }}>
                      {W === "plans" ? "Compare plans" : W === "voce" ? "NORA · VOCE" : "NORA"}
                    </span>
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 12,
                        color: "#5f6368",
                      }}
                    >
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: typing
                            ? "#9b72f2"
                            : nora.mood === "working"
                              ? "#7b4ce0"
                              : "#34a853",
                        }}
                      />
                      {typing
                        ? "Thinking…"
                        : W === "plans"
                          ? `Trial · day ${day} of 30`
                          : W === "recap"
                            ? "Your day 24 recap"
                            : W === "voce"
                              ? "Setting up your first article"
                              : (nora.status ?? `On for you · day ${day} of 30`)}
                    </span>
                  </div>
                  {W === "talk" && !nora.noUses ? (
                    <button
                      type="button"
                      onClick={() => setWin("uses")}
                      style={{
                        height: 32,
                        border: "1px solid #d2e3fc",
                        borderRadius: 999,
                        background: "#fff",
                        padding: "0 12px",
                        font: "700 12px Arial,sans-serif",
                        color: "#1a73e8",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      What I can use
                    </button>
                  ) : null}
                  <CloseBtn onClick={() => setWin(null)} size={36} />
                </div>

                <div
                  ref={bodyRef}
                  style={{
                    flex: 1,
                    minHeight: 0,
                    overflow: "auto",
                    padding: "4px 18px 16px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 14,
                  }}
                >
                  {W === "talk" ? (
                    <>
                      <div
                        style={{
                          alignSelf: "flex-start",
                          maxWidth: "92%",
                          borderRadius: "4px 18px 18px 18px",
                          background: "#f5f7fb",
                          padding: "12px 14px",
                          fontSize: 15,
                          lineHeight: 1.5,
                        }}
                      >
                        {nora.greeting ?? (
                          <>
                            Hi Dana.{" "}
                            <b>
                              {day >= 7
                                ? "You crossed into Established this week."
                                : "I've started on your plan."}
                            </b>{" "}
                            Ask me anything.
                          </>
                        )}
                      </div>
                      {msgs.length === 0 ? (
                        <>
                          {nora.intro}
                          {thinks.length ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
                                <Ic name="spark" size={14} color="#7b4ce0" />
                                WHAT I THINK
                              </span>
                              <div
                                style={{
                                  display: "grid",
                                  gap: 8,
                                  gridTemplateColumns: isD
                                    ? `repeat(${Math.min(thinks.length, 3)},minmax(0,1fr))`
                                    : "minmax(0,1fr)",
                                }}
                              >
                                {thinks.map((t, i) => (
                                  <div
                                    key={t.t}
                                    style={{
                                      borderRadius: 18,
                                      background: i ? "#fff" : "#f5f9ff",
                                      border: `1px solid ${i ? "#eceef1" : "#d2e3fc"}`,
                                      padding: 14,
                                      display: "flex",
                                      flexDirection: "column",
                                      gap: 6,
                                      animation: `hf-rise .32s ease ${80 + i * 70}ms both`,
                                    }}
                                  >
                                    <span
                                      style={{
                                        fontSize: 14,
                                        fontWeight: 700,
                                        lineHeight: 1.35,
                                        color: "#202124",
                                      }}
                                    >
                                      {t.t}
                                    </span>
                                    <span
                                      style={{
                                        flex: 1,
                                        fontSize: 13,
                                        lineHeight: 1.45,
                                        color: "#5f6368",
                                      }}
                                    >
                                      {t.d}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => run(t.act)}
                                      style={{
                                        ...btnReset,
                                        alignSelf: "flex-start",
                                        marginTop: 4,
                                        background: "none",
                                        padding: 0,
                                        font: "700 13px Arial,sans-serif",
                                        color: "#1a73e8",
                                      }}
                                    >
                                      {t.cta} →
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          {nora.outro}
                        </>
                      ) : null}
                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {msgs.map((m, idx) =>
                          m.me ? (
                            <div
                              key={idx}
                              style={{
                                alignSelf: "flex-end",
                                maxWidth: "80%",
                                borderRadius: "18px 18px 4px 18px",
                                background: "#1a73e8",
                                padding: "10px 14px",
                                fontSize: 14,
                                lineHeight: 1.45,
                                color: "#fff",
                                animation: "hf-rise .25s ease both",
                              }}
                            >
                              {m.t}
                            </div>
                          ) : (
                            <NoraAnswer key={idx} msg={m} onAct={run} onToast={toast} />
                          ),
                        )}
                        {typing ? (
                          <div
                            style={{
                              alignSelf: "flex-start",
                              display: "flex",
                              gap: 10,
                              alignItems: "center",
                            }}
                          >
                            <NoraFace size={30} mood="working" />
                            <span
                              style={{
                                display: "flex",
                                gap: 4,
                                borderRadius: 999,
                                background: "#f5f7fb",
                                padding: "12px 14px",
                              }}
                            >
                              {[0, 0.15, 0.3].map((d) => (
                                <span
                                  key={d}
                                  style={{
                                    width: 6,
                                    height: 6,
                                    borderRadius: "50%",
                                    background: "#9b72f2",
                                    animation: `hf-bounce 1s ease-in-out ${d}s infinite`,
                                  }}
                                />
                              ))}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    </>
                  ) : null}

                  {W === "uses" ? (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        animation: "hf-rise .25s ease both",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setWin("talk")}
                        style={{
                          ...btnReset,
                          alignSelf: "flex-start",
                          background: "none",
                          padding: 0,
                          font: "700 13px Arial,sans-serif",
                          color: "#1a73e8",
                        }}
                      >
                        ← Back to chat
                      </button>
                      <span style={{ fontSize: 14, lineHeight: 1.5, color: "#3c4043" }}>
                        These are the sources I'm allowed to read and act on. Turn any off and I'll
                        stop using it.
                      </span>
                      {(
                        [
                          ["Google Business Profile", false],
                          ["Website", false],
                          ["LinkedIn", false],
                          ["Facebook", false],
                          ["Zillow", false],
                          ["Search Console", true],
                        ] as [string, boolean][]
                      ).map(([n, needsConnect]) => {
                        const isConnect = needsConnect && !connected[n];
                        const on = !!uses[n] || (needsConnect && !!connected[n]);
                        return (
                          <div
                            key={n}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 12,
                              borderRadius: 14,
                              background: "#f8f9fb",
                              padding: 12,
                            }}
                          >
                            <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{n}</span>
                            {isConnect ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setConnected((c) => ({ ...c, [n]: true }));
                                  setUses((u) => ({ ...u, [n]: true }));
                                }}
                                style={{
                                  ...btnReset,
                                  height: 30,
                                  borderRadius: 999,
                                  background: "#1a73e8",
                                  padding: "0 12px",
                                  font: "700 12px Arial,sans-serif",
                                  color: "#fff",
                                }}
                              >
                                Connect
                              </button>
                            ) : (
                              <Toggle
                                on={on}
                                onClick={() => setUses((u) => ({ ...u, [n]: !u[n] }))}
                                w={44}
                                h={26}
                                label={n}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}

                  {W === "voce" ? (
                    <VocePanel
                      step={voce}
                      busy={voceBusy}
                      onNext={() => voceStep(() => setVoce(2), 900)}
                      onPublish={() => voceStep(() => setVoce(3), 1100)}
                      onEdit={() => toast("Opens the editor in VOCE")}
                      onDone={() => setWin(null)}
                    />
                  ) : null}

                  {W === "plans" ? (
                    <PlansPanel
                      isD={isD}
                      onChoose={(plan) =>
                        toast(`${plan}: billing is not connected in this prototype`)
                      }
                    />
                  ) : null}

                  {W === "upgrade" ? (
                    <UpgradePanel onCompare={() => setWin("plans")} onNotNow={() => setWin(null)} />
                  ) : null}

                  {W === "recap" ? (
                    <RecapPanel
                      isD={isD}
                      onCompare={() => setWin("plans")}
                      onRemind={() => {
                        setWin(null);
                        toast("I'll remind you on day 28");
                      }}
                    />
                  ) : null}
                </div>

                {W === "talk" ? (
                  <div
                    style={{
                      flex: "none",
                      borderTop: "1px solid #f1f3f4",
                      padding: "12px 16px 16px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: ".12em",
                        color: "#5f6368",
                      }}
                    >
                      TRY ASKING
                    </span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {chips.map((c) => (
                        <Hov
                          key={c}
                          onClick={() => (c === "Fix my website" ? run("website") : ask(c))}
                          style={{
                            height: 32,
                            border: "1px solid #d2e3fc",
                            borderRadius: 999,
                            background: "#f5f9ff",
                            padding: "0 12px",
                            font: "600 12px Arial,sans-serif",
                            color: "#1967d2",
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                          }}
                          hover={{ background: "#e8f0fe" }}
                        >
                          {c}
                        </Hov>
                      ))}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        height: 50,
                        borderRadius: 16,
                        background: "#f5f7fb",
                        padding: "0 6px 0 10px",
                      }}
                    >
                      <RoundIcon
                        label="Attach"
                        onClick={() => toast("Attach a file or photo")}
                        size={30}
                        bg="#fff"
                      >
                        <Ic name="plus" size={16} />
                      </RoundIcon>
                      <input
                        ref={inputRef}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            ask(e.currentTarget.value);
                            e.currentTarget.value = "";
                          }
                        }}
                        placeholder="Ask NORA…"
                        style={{
                          flex: 1,
                          minWidth: 0,
                          border: 0,
                          background: "transparent",
                          font: "15px Arial,sans-serif",
                          color: "#202124",
                          outline: "none",
                        }}
                      />
                      <RoundIcon
                        label="Voice"
                        onClick={() => toast("Listening…")}
                        size={34}
                        bg="transparent"
                      >
                        <Ic name="mic" size={18} />
                      </RoundIcon>
                      <button
                        type="button"
                        onClick={() => {
                          const el = inputRef.current;
                          if (el) {
                            ask(el.value);
                            el.value = "";
                          }
                        }}
                        aria-label="Send"
                        style={{
                          ...btnReset,
                          width: 38,
                          height: 38,
                          borderRadius: 12,
                          background: "#1a73e8",
                          display: "grid",
                          placeItems: "center",
                          color: "#fff",
                        }}
                      >
                        <Ic name="send" size={16} color="#fff" />
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          {overlay}

          {toastMsg ? (
            <div
              role="status"
              style={{
                position: "absolute",
                left: "50%",
                top: 18,
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
              {toastMsg}
            </div>
          ) : null}
        </div>
      </div>
    </HfCtx.Provider>
  );
}

function NoraAnswer({
  msg,
  onAct,
  onToast,
}: {
  msg: Extract<Msg, { me: false }>;
  onAct: (a: HfAct) => void;
  onToast: (m: string) => void;
}) {
  const cells = msg.map === "river" ? RIVER_CELLS : YOU_CELLS;
  return (
    <div
      style={{
        alignSelf: "flex-start",
        maxWidth: "96%",
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        animation: "hf-rise .3s ease both",
      }}
    >
      <NoraFace size={30} />
      <div
        style={{
          flex: 1,
          minWidth: 0,
          borderRadius: "4px 18px 18px 18px",
          background: "#fff",
          border: "1px solid #e8eaed",
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          boxShadow: "0 4px 12px rgba(66,133,244,.08)",
        }}
      >
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>
          {parseBold(msg.t).map((s, i) =>
            s.b ? <b key={i}>{s.t}</b> : <span key={i}>{s.t}</span>,
          )}
        </p>
        {msg.map ? (
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7,14px)",
                gap: 3,
                flex: "none",
              }}
            >
              {cells.map((g, i) => (
                <span key={i} style={{ width: 14, height: 14, borderRadius: 3, background: g }} />
              ))}
            </div>
            <span style={{ fontSize: 12, lineHeight: 1.4, color: "#5f6368" }}>
              {msg.map === "river"
                ? "34 of 49 spots where Riverbend ranks above you"
                : "Green: top 3 · yellow: 4–10 · orange: 11–20 · red: 20+"}
            </span>
          </div>
        ) : null}
        {msg.acts && msg.acts.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {msg.acts.map(([l, a, pri]) => (
              <button
                type="button"
                key={l}
                onClick={() => onAct(a)}
                style={{
                  height: 36,
                  border: pri ? 0 : "1px solid #d2e3fc",
                  borderRadius: 12,
                  background: pri ? "#1a73e8" : "#fff",
                  padding: "0 14px",
                  font: "700 13px Arial,sans-serif",
                  color: pri ? "#fff" : "#1a73e8",
                  cursor: "pointer",
                }}
              >
                {l}
              </button>
            ))}
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 4, color: "#80868b" }}>
          {(
            [
              ["Copy", "copy", "Copied"],
              ["Helpful", "up", "Thanks — noted"],
              ["Not helpful", "down", "Thanks — noted"],
            ] as [string, HfIconName, string][]
          ).map(([l, i, t]) => (
            <Hov
              key={l}
              onClick={() => onToast(t)}
              aria-label={l}
              style={{
                width: 30,
                height: 30,
                border: 0,
                borderRadius: "50%",
                background: "transparent",
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
                color: "#80868b",
              }}
              hover={{ background: "#f1f3f4" }}
            >
              <Ic name={i} size={15} />
            </Hov>
          ))}
        </div>
      </div>
    </div>
  );
}

function VocePanel({
  step,
  busy,
  onNext,
  onPublish,
  onEdit,
  onDone,
}: {
  step: 1 | 2 | 3;
  busy: boolean;
  onNext: () => void;
  onPublish: () => void;
  onEdit: () => void;
  onDone: () => void;
}) {
  const shield = <Ic name="shield" size={12} color="#137333" sw={2.4} />;
  const spinner = busy ? (
    <span
      style={{
        width: 16,
        height: 16,
        borderRadius: "50%",
        border: "2px solid rgba(255,255,255,.4)",
        borderTopColor: "#fff",
        animation: "hf-nSpin .8s linear infinite",
      }}
    />
  ) : null;
  const primary: CSSProperties = {
    ...btnReset,
    height: 48,
    borderRadius: 14,
    background: "#1a73e8",
    font: "700 15px Arial,sans-serif",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  };
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        animation: "hf-rise .25s ease both",
      }}
    >
      <div
        style={{
          alignSelf: "flex-start",
          borderRadius: "4px 18px 18px 18px",
          background: "#f5f7fb",
          padding: "12px 14px",
          fontSize: 15,
          lineHeight: 1.5,
        }}
      >
        You offer <b>VA loans</b> but have nothing written about them. Riverbend has 14 articles.
        I'll set you up on VOCE with <b>100 free credits</b> and draft your first article.
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {["Sign in", "Draft", "Published"].map((l, i) => (
          <div key={l} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <span
              style={{
                height: 4,
                borderRadius: 2,
                background: i + 1 < step ? "#34a853" : i + 1 === step ? "#1a73e8" : "#dadce0",
                transition: "background .4s",
              }}
            />
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: i + 1 <= step ? "#202124" : "#9aa0a6",
              }}
            >
              {l}
            </span>
          </div>
        ))}
      </div>
      {step === 1 ? (
        <div
          style={{
            borderRadius: 20,
            border: "1px solid #e8eaed",
            padding: 18,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            animation: "hf-rise .3s ease both",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span
              style={{
                width: 44,
                height: 44,
                flex: "none",
                borderRadius: 12,
                background: "linear-gradient(135deg,#4285f4,#9b72f2)",
                display: "grid",
                placeItems: "center",
                color: "#fff",
              }}
            >
              <Ic name="book" size={20} color="#fff" />
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <b style={{ fontSize: 16 }}>Sign in to VOCE with your Experience.com account</b>
              <span style={{ fontSize: 13, color: "#5f6368" }}>
                Single sign-on — no new password.
              </span>
            </div>
          </div>
          <button type="button" onClick={onNext} style={primary}>
            {spinner}Continue
          </button>
        </div>
      ) : null}
      {step === 2 ? (
        <div
          style={{
            borderRadius: 20,
            border: "1px solid #e8eaed",
            padding: 18,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            animation: "hf-rise .3s ease both",
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".12em", color: "#7b4ce0" }}>
            DRAFT · READY FOR YOU
          </span>
          <h3 style={{ margin: 0, font: "600 22px/1.25 Lora,Georgia,serif" }}>
            VA loans in Davenport: what veterans should know
          </h3>
          <span style={{ fontSize: 12, color: "#5f6368" }}>
            Dana Whitfield · Senior Loan Officer · NMLS 482913
          </span>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "#3c4043" }}>
            If you've served, a VA loan can help you buy a home in Davenport without a down payment.
            Here's how eligibility, the funding fee and the appraisal work — and what to have ready
            before you apply.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {["No rate promises", "NMLS shown"].map((l) => (
              <span
                key={l}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  borderRadius: 999,
                  background: "#e6f4ea",
                  padding: "4px 10px",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#137333",
                }}
              >
                {shield}
                {l}
              </span>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={onEdit}
              style={{
                height: 46,
                border: "1px solid #dadce0",
                borderRadius: 14,
                background: "#fff",
                padding: "0 18px",
                font: "700 15px Arial,sans-serif",
                color: "#3c4043",
                cursor: "pointer",
              }}
            >
              Edit
            </button>
            <button type="button" onClick={onPublish} style={{ ...primary, flex: 1, height: 46 }}>
              {spinner}Publish to my profile
            </button>
          </div>
        </div>
      ) : null}
      {step === 3 ? (
        <div
          style={{
            borderRadius: 20,
            background: "#e6f4ea",
            border: "1.5px solid #ceead6",
            padding: 20,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
            textAlign: "center",
            animation: "hf-pop .4s cubic-bezier(.2,.8,.2,1) both",
          }}
        >
          <span
            style={{
              width: 52,
              height: 52,
              borderRadius: "50%",
              background: "#34a853",
              display: "grid",
              placeItems: "center",
            }}
          >
            <Tick size={14} />
          </span>
          <span style={{ fontSize: 24, fontWeight: 700, color: "#137333" }}>
            Published. +12 points.
          </span>
          <span style={{ fontSize: 13, color: "#3c4043" }}>
            100 free credits · this article used 8
          </span>
          <button
            type="button"
            onClick={onDone}
            style={{ ...primary, marginTop: 4, height: 44, padding: "0 24px" }}
          >
            Done
          </button>
        </div>
      ) : null}
    </div>
  );
}

function UpgradePanel({ onCompare, onNotNow }: { onCompare: () => void; onNotNow: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        animation: "hf-rise .25s ease both",
      }}
    >
      <div
        style={{
          borderRadius: 20,
          background: "#fef7e0",
          border: "1px solid #fbe3a4",
          padding: 18,
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
            color: "#b06000",
          }}
        >
          <Ic name="lock" size={16} color="#b06000" sw={2.4} />
          YOUR BIGGEST GAP IS LOCKED
        </span>
        <span style={{ fontSize: 16, lineHeight: 1.5 }}>
          <b>22 directories are missing you or show your old phone. 42 points are waiting.</b>{" "}
          Engage keeps your details right everywhere; Amplify includes it.
        </span>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={onCompare}
          style={{
            ...btnReset,
            flex: 1,
            height: 48,
            borderRadius: 14,
            background: "#1a73e8",
            font: "700 15px Arial,sans-serif",
            color: "#fff",
          }}
        >
          Compare plans
        </button>
        <button
          type="button"
          onClick={onNotNow}
          style={{
            height: 48,
            border: "1px solid #dadce0",
            borderRadius: 14,
            background: "#fff",
            padding: "0 20px",
            font: "700 15px Arial,sans-serif",
            color: "#3c4043",
            cursor: "pointer",
          }}
        >
          Not now
        </button>
      </div>
    </div>
  );
}

function RecapPanel({
  isD,
  onCompare,
  onRemind,
}: {
  isD: boolean;
  onCompare: () => void;
  onRemind: () => void;
}) {
  const tiles: [string, string, string, string][] = [
    ["Score", "384", "471", "+87"],
    ["Rank in Davenport", "#6", "#4", ""],
    ["Profile strength", "64%", "88%", ""],
    ["Articles published", "", "3", ""],
    ["Reviews answered", "", "12", ""],
  ];
  const card: CSSProperties = {
    borderRadius: 18,
    border: "1px solid #e8eaed",
    padding: 14,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  };
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        animation: "hf-rise .3s ease both",
      }}
    >
      <h2
        style={{
          margin: "6px 0 0",
          font: "600 30px/1.2 Lora,Georgia,serif",
          letterSpacing: "-0.01em",
        }}
      >
        In 24 days I did{" "}
        <span
          style={{
            background: "linear-gradient(135deg,#4285f4,#9b72f2 45%,#ea4335)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
          }}
        >
          41 things
        </span>{" "}
        for you.
      </h2>
      <div
        style={{
          display: "grid",
          gap: 10,
          gridTemplateColumns: isD ? "repeat(5,minmax(0,1fr))" : "repeat(2,minmax(0,1fr))",
        }}
      >
        {tiles.map(([k, f, t, d], i) => (
          <div
            key={k}
            style={{
              gridColumn: !isD && i === 0 ? "1 / -1" : "auto",
              borderRadius: 18,
              background: "#f5f7fb",
              padding: 14,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              animation: `hf-rise .35s ease ${100 + i * 70}ms both`,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: "#5f6368" }}>{k}</span>
            <span
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 6,
                flexWrap: "wrap",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {f ? <span style={{ fontSize: 15, color: "#9aa0a6" }}>{f} →</span> : null}
              <span
                style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1 }}
              >
                {t}
              </span>
              {d ? <b style={{ fontSize: 13, color: "#137333" }}>{d}</b> : null}
            </span>
          </div>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          borderRadius: 18,
          background: "#e6f4ea",
          padding: "14px 16px",
        }}
      >
        <span style={{ flex: "1 1 260px", fontSize: 14, lineHeight: 1.5 }}>
          <b>You: +87 in 24 days.</b> Loan officers like you on Amplify: median +61 in 90 days.
        </span>
        <span style={{ fontSize: 11, color: "#5f6368" }}>Illustrative</span>
      </div>
      <div
        style={{ display: "grid", gap: 10, gridTemplateColumns: isD ? "1fr 1fr" : "minmax(0,1fr)" }}
      >
        <div style={card}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".12em", color: "#137333" }}>
            ON DAY 31 · STAYS FREE
          </span>
          {[
            "Your profile",
            "Reviews",
            "Referral network",
            "Single social posts",
            "Chat with NORA",
          ].map((s) => (
            <span key={s} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
              <Tick size={14} color="#137333" />
              {s}
            </span>
          ))}
        </div>
        <div style={card}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".12em", color: "#b06000" }}>
            ON DAY 31 · PAUSES
          </span>
          {["NORA's drafts, fixes and weekly brief", "Website audits"].map((s) => (
            <span key={s} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
              <Ic name="lock" size={14} color="#b06000" />
              {s}
            </span>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={onCompare}
          style={{
            ...btnReset,
            flex: "1 1 180px",
            height: 50,
            borderRadius: 14,
            background: "#1a73e8",
            font: "700 15px Arial,sans-serif",
            color: "#fff",
          }}
        >
          Compare plans
        </button>
        <button
          type="button"
          onClick={onRemind}
          style={{
            flex: "1 1 180px",
            height: 50,
            border: "1px solid #dadce0",
            borderRadius: 14,
            background: "#fff",
            font: "700 15px Arial,sans-serif",
            color: "#3c4043",
            cursor: "pointer",
          }}
        >
          Remind me on day 28
        </button>
      </div>
    </div>
  );
}

function MobileNav({
  screen,
  onHome,
  onInsights,
  onNora,
  onProfile,
  onMore,
  noraMood,
  hideNora,
}: {
  screen: HfScreen;
  onHome: () => void;
  onInsights: () => void;
  onNora: () => void;
  onProfile: () => void;
  onMore: () => void;
  noraMood?: NoraMood;
  /** Leave the centre tab empty while NORA's arrival flies in. */
  hideNora?: boolean;
}) {
  const all: { label: string; icon: HfIconName | null; active: boolean; on: () => void }[] = [
    { label: "Home", icon: "home", active: screen === "home", on: onHome },
    { label: "Insights", icon: "chart", active: screen === "insights", on: onInsights },
    { label: "NORA", icon: null, active: false, on: onNora },
    { label: "Profile", icon: "user", active: screen === "profile", on: onProfile },
    {
      label: "More",
      icon: "more",
      active: ["connections", "website", "network", "settings", "srs"].includes(screen),
      on: onMore,
    },
  ];
  const items = HF_NORA_UI ? all : all.filter((n) => n.icon !== null);
  return (
    <nav
      style={{
        position: "absolute",
        left: 12,
        right: 12,
        bottom: 12,
        zIndex: 30,
        height: 66,
        borderRadius: 24,
        background: "rgba(255,255,255,.96)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        boxShadow: "0 10px 30px rgba(66,133,244,.18)",
        display: "grid",
        gridTemplateColumns: `repeat(${items.length},minmax(0,1fr))`,
        alignItems: "center",
      }}
    >
      {items.map((n) => (
        <button
          type="button"
          key={n.label}
          onClick={n.on}
          aria-label={n.label}
          style={{
            ...btnReset,
            height: "100%",
            background: "none",
            padding: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 3,
            font: "700 10px Arial,sans-serif",
            color: n.active ? "#1a73e8" : n.icon === null ? "#7b4ce0" : "#80868b",
          }}
        >
          {n.icon === null ? (
            <span
              style={{
                marginTop: -30,
                borderRadius: "50%",
                padding: 4,
                background: "#fff",
                boxShadow: "0 6px 18px rgba(155,114,242,.3)",
                display: "flex",
              }}
            >
              {hideNora ? (
                <span style={{ width: 48, height: 48 }} />
              ) : (
                <NoraFace size={48} mood={noraMood} />
              )}
            </span>
          ) : (
            <Ic name={n.icon} size={20} />
          )}
          {n.label}
        </button>
      ))}
    </nav>
  );
}

function DemoBar({
  day,
  isD,
  isM,
  current,
  showEvents,
  onRestart,
  onDay,
  onPick,
  onDevice,
  extra,
}: {
  day: HfDay;
  isD: boolean;
  isM: boolean;
  current: HfScreen;
  showEvents: boolean;
  onRestart: () => void;
  onDay: (d: HfDay) => void;
  onPick: (t: HfTarget) => void;
  onDevice: (d: "mobile" | "desktop") => void;
  extra?: ReactNode;
}) {
  const pill = (on: boolean, onBg = "#fff"): CSSProperties => ({
    ...btnReset,
    height: 30,
    borderRadius: 999,
    padding: "0 12px",
    background: on ? onBg : "transparent",
    font: "700 12px Arial,sans-serif",
    color: on ? "#202124" : "#e8eaed",
    whiteSpace: "nowrap",
  });
  const sep = (
    <span style={{ width: 1, height: 18, background: "rgba(255,255,255,.2)", margin: "0 4px" }} />
  );
  const value = current === "home" ? (day === 7 ? "day7" : day === 24 ? "recap" : "home") : current;
  return (
    <div
      aria-label="Prototype demo controls"
      style={{
        position: "fixed",
        left: "50%",
        bottom: 14,
        transform: "translateX(-50%)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        gap: 4,
        borderRadius: 999,
        background: "#202124",
        padding: 4,
        boxShadow: "0 8px 24px rgba(0,0,0,.25)",
        maxWidth: "calc(100vw - 16px)",
        overflowX: "auto",
      }}
    >
      <button type="button" onClick={onRestart} style={{ ...pill(true, "#1a73e8"), color: "#fff" }}>
        ↺ Restart flow
      </button>
      {([1, 7, 24] as HfDay[]).map((n) => (
        <button type="button" key={n} onClick={() => onDay(n)} style={pill(day === n)}>
          Day {n}
        </button>
      ))}
      {sep}
      <select
        value={value}
        onChange={(e) => onPick(e.target.value as HfTarget)}
        aria-label="Jump to screen"
        style={{
          height: 30,
          border: 0,
          borderRadius: 999,
          background: "#3c4043",
          padding: "0 10px",
          font: "700 12px Arial,sans-serif",
          color: "#fff",
          cursor: "pointer",
          outline: "none",
        }}
      >
        {PICKS.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
      {showEvents ? (
        <>
          {sep}
          <EventButtons />
        </>
      ) : null}
      {extra ? (
        <>
          {sep}
          {extra}
        </>
      ) : null}
      {sep}
      <button type="button" onClick={() => onDevice("mobile")} style={pill(isM, "#8ab4f8")}>
        Mobile
      </button>
      <button type="button" onClick={() => onDevice("desktop")} style={pill(isD, "#8ab4f8")}>
        Desktop
      </button>
    </div>
  );
}

/** Event pop-up triggers (screen 14): dispatched to the day-7 home through a window event. */
function EventButtons() {
  const fire = (kind: "review" | "fb" | "upgrade") =>
    window.dispatchEvent(new CustomEvent("hf-event", { detail: kind }));
  const s: CSSProperties = {
    ...btnReset,
    height: 30,
    borderRadius: 999,
    padding: "0 10px",
    background: "transparent",
    font: "700 12px Arial,sans-serif",
    color: "#fdd663",
    whiteSpace: "nowrap",
  };
  return (
    <>
      <button type="button" style={s} onClick={() => fire("review")}>
        2★ review
      </button>
      <button type="button" style={s} onClick={() => fire("fb")}>
        Facebook
      </button>
      <button type="button" style={s} onClick={() => fire("upgrade")}>
        Upgrade
      </button>
    </>
  );
}

export function CloseBtn({ onClick, size = 36 }: { onClick: () => void; size?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Close"
      style={{
        ...btnReset,
        width: size,
        height: size,
        flex: "none",
        borderRadius: "50%",
        background: "#f1f3f4",
        display: "grid",
        placeItems: "center",
        color: "#5f6368",
      }}
    >
      <Ic name="x" size={16} />
    </button>
  );
}

function RoundIcon({
  label,
  onClick,
  size,
  bg,
  children,
}: {
  label: string;
  onClick: () => void;
  size: number;
  bg: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={{
        ...btnReset,
        width: size,
        height: size,
        borderRadius: "50%",
        background: bg,
        display: "grid",
        placeItems: "center",
        color: "#5f6368",
      }}
    >
      {children}
    </button>
  );
}

/** The prototype's pill toggle switch. */
export function Toggle({
  on,
  onClick,
  w = 46,
  h = 28,
  label,
  locked = false,
}: {
  on: boolean;
  onClick: () => void;
  w?: number;
  h?: number;
  label: string;
  locked?: boolean;
}) {
  const knob = h - 6;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={locked ? undefined : onClick}
      style={{
        position: "relative",
        width: w,
        height: h,
        flex: "none",
        border: 0,
        borderRadius: h / 2,
        background: on ? "#1a73e8" : "#dadce0",
        cursor: locked ? "default" : "pointer",
        opacity: locked ? 0.6 : 1,
        transition: "background .2s",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: on ? w - knob - 3 : 3,
          width: knob,
          height: knob,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 3px rgba(0,0,0,.2)",
          transition: "left .2s",
        }}
      />
    </button>
  );
}

/** Trial limits + upgrade CTA shown to the claimed professional on every Happyflow page. */
function PlanBanner({
  day,
  onCompare,
  onClose,
}: {
  day: HfDay;
  onCompare: () => void;
  onClose: () => void;
}) {
  return (
    <div
      role="region"
      aria-label="Plan limits"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        borderRadius: 18,
        background: "#fef7e0",
        border: "1px solid #fbe3a4",
        padding: "12px 14px",
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
      <span style={{ flex: "1 1 260px", fontSize: 14, lineHeight: 1.45 }}>
        <b>Trial · day {day} of 30.</b> Listings, VOCE articles, Map Rank tracking and AI-citation
        monitoring are locked — <b>127 points</b> are waiting behind them.
      </span>
      <button
        type="button"
        onClick={onCompare}
        style={{
          ...btnReset,
          height: 38,
          borderRadius: 12,
          background: "#1a73e8",
          padding: "0 16px",
          font: "700 13px Arial,sans-serif",
          color: "#fff",
          whiteSpace: "nowrap",
        }}
      >
        Compare plans
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss"
        style={{
          ...btnReset,
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: "rgba(255,255,255,.7)",
          display: "grid",
          placeItems: "center",
          color: "#5f6368",
        }}
      >
        <Ic name="x" size={16} />
      </button>
    </div>
  );
}

const PLANS: { name: string; tag: string; items: string[]; cta?: string; highlight?: boolean }[] = [
  {
    name: "Core",
    tag: "Your trial today · stays free after day 30",
    items: ["Your profile", "Reviews", "Referral network", "Single social posts", "Chat with NORA"],
  },
  {
    name: "Engage",
    tag: "Listings",
    items: [
      "Everything in Core",
      "Publish your details to Apple Maps, Bing and 28 directories",
      "Correct the 22 directories that miss you or show your old phone · +42 points",
    ],
    cta: "Choose Engage",
  },
  {
    name: "Amplify",
    tag: "Includes Engage",
    items: [
      "Everything in Engage",
      "VOCE articles · 85 points open in Articles",
      "Map Rank tracking · see the week you pass Riverbend",
      "AI-citation monitoring",
      "NORA's drafts, fixes and weekly brief",
      "Website audits",
    ],
    cta: "Choose Amplify",
    highlight: true,
  },
];

function PlansPanel({ isD, onChoose }: { isD: boolean; onChoose: (plan: string) => void }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        animation: "hf-rise .25s ease both",
      }}
    >
      <div
        style={{
          display: "grid",
          gap: 10,
          gridTemplateColumns: isD ? "repeat(3,minmax(0,1fr))" : "minmax(0,1fr)",
        }}
      >
        {PLANS.map((p) => (
          <div
            key={p.name}
            style={{
              borderRadius: 20,
              border: `1.5px solid ${p.highlight ? "#c6dafc" : "#e8eaed"}`,
              background: p.highlight ? "#f5f9ff" : "#fff",
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <b style={{ fontSize: 18 }}>{p.name}</b>
              <span style={{ fontSize: 12, color: "#5f6368" }}>{p.tag}</span>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
              {p.items.map((it) => (
                <span key={it} style={{ display: "flex", gap: 8, fontSize: 13, lineHeight: 1.4 }}>
                  <span style={{ marginTop: 2 }}>
                    <Tick size={13} color="#137333" />
                  </span>
                  {it}
                </span>
              ))}
            </div>
            {p.cta ? (
              <button
                type="button"
                onClick={() => onChoose(p.name)}
                style={{
                  ...btnReset,
                  height: 42,
                  borderRadius: 12,
                  background: p.highlight ? "#1a73e8" : "#fff",
                  border: p.highlight ? 0 : "1px solid #d2e3fc",
                  font: "700 14px Arial,sans-serif",
                  color: p.highlight ? "#fff" : "#1a73e8",
                }}
              >
                {p.cta}
              </button>
            ) : (
              <span
                style={{
                  height: 42,
                  borderRadius: 12,
                  background: "#f1f3f4",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#5f6368",
                }}
              >
                Current plan
              </span>
            )}
          </div>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          borderRadius: 18,
          background: "#e6f4ea",
          padding: "12px 16px",
        }}
      >
        <span style={{ flex: "1 1 260px", fontSize: 13, lineHeight: 1.5 }}>
          <b>Loan officers like you on Amplify:</b> median +61 points in 90 days; 3 of 5 reached the
          next band.
        </span>
        <span style={{ fontSize: 11, color: "#5f6368" }}>Illustrative</span>
      </div>
    </div>
  );
}
