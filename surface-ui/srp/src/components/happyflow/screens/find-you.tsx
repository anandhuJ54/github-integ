/**
 * Find you + Claim (Happyflow sign-up steps 1–2, screens 1–2). Ported 1:1 from the Claude Design
 * prototype "Find You". Demo data only — no search or auth calls; signing in opens the interview.
 * This screen has its own frame (no HappyflowShell), like the prototype.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { HF_EMBED_HEIGHT, useHfNav } from "../seat-nav";
import "../happyflow.css";
import { HF_ASSETS } from "../demo-data";
import { useHfPersona, usePersonalize } from "../persona-context";
import { Hov, NoraFace, prefersReducedMotion } from "../primitives";
import { useHfDevice } from "../use-hf-device";

// Demo data (Happyflow prototype)
type Person = {
  id: number;
  name: string;
  title: string;
  city: string;
  photo: string;
  pos: string;
  likely?: boolean;
};
const PEOPLE: Person[] = [
  {
    id: 0,
    name: "Alex Sample",
    title: "Senior Loan Officer · Demo Mortgage Co",
    city: "Davenport, IA",
    photo: HF_ASSETS.samplePhoto,
    pos: "50% 22%",
    likely: true,
  },
  {
    id: 1,
    name: "Alex Sample",
    title: "Real estate agent",
    city: "Tampa, FL",
    photo: HF_ASSETS.sampleTampaPhoto,
    pos: "50% 30%",
  },
  {
    id: 2,
    name: "Alex Sampler",
    title: "Loan Officer",
    city: "Moline, IL",
    photo: HF_ASSETS.sampleSimilarPhoto,
    pos: "50% 26%",
  },
];
const GREETING = "Hi, I'm NORA. Once you claim your profile, I'll set it up for you.";

const match = (q: string, people: Person[]) => {
  const t = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!t.length) return [];
  return people.filter((p) =>
    t.every((x) =>
      p.name
        .toLowerCase()
        .split(" ")
        .some((n) => n.startsWith(x) || (x.length > 3 && n.startsWith(x.slice(0, 4)))),
    ),
  );
};

const VIOLET = "oklch(0.5108 0.2385 296.5)";
const BLUE = "oklch(0.5798 0.204 259.1)";
const INK = "oklch(0.2371 0.0043 285.9)";
const NAVY = "oklch(0.2652 0.0587 254.5)";
const CTA_GRAD = `linear-gradient(100deg,${VIOLET},${BLUE})`;
const NORA_SHADOW = "0 4px 14px rgba(155,114,242,.3)";

type SsoKey = "apple" | "ms" | "li";

function SsoMark({ k }: { k: SsoKey }) {
  if (k === "apple")
    return (
      <svg width={18} height={18} viewBox="0 0 24 24" fill="#000" aria-hidden>
        <path d="M16.37 12.63c-.02-2.2 1.8-3.27 1.88-3.32-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.87-.76-1.47.02-2.83.86-3.59 2.18-1.53 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.24 2.73 2.2 1.1-.05 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.84-1.22 1.18-2.41 1.2-2.47-.03-.01-2.3-.88-2.29-3.51zM14.2 6.17c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.65-1.05 1.69-.92 2.68.97.08 1.96-.49 2.56-1.23z" />
      </svg>
    );
  if (k === "ms")
    return (
      <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden>
        <rect x={1} y={1} width={10} height={10} fill="#F25022" />
        <rect x={13} y={1} width={10} height={10} fill="#7FBA00" />
        <rect x={1} y={13} width={10} height={10} fill="#00A4EF" />
        <rect x={13} y={13} width={10} height={10} fill="#FFB900" />
      </svg>
    );
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden>
      <rect width={24} height={24} rx={4} fill="#0A66C2" />
      <path
        fill="#fff"
        d="M7.1 9.5H4.6V19h2.5V9.5zM5.85 8.3a1.45 1.45 0 1 0 0-2.9 1.45 1.45 0 0 0 0 2.9zM19.4 13.6c0-2.6-1.4-4.3-3.6-4.3-1.2 0-2.1.6-2.5 1.3V9.5h-2.4V19h2.5v-5c0-1.3.6-2.2 1.8-2.2 1.1 0 1.6.8 1.6 2.2v5h2.6v-5.4z"
      />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg width={16} height={16} viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

const SSO_ALT: [string, SsoKey][] = [
  ["Apple", "apple"],
  ["Microsoft", "ms"],
  ["LinkedIn", "li"],
];

type Claim = null | "idle" | "opening";

export function FindYouScreen() {
  const persona = useHfPersona();
  const tx = usePersonalize();
  const { isD, isM, framed } = useHfDevice();
  const hfNav = useHfNav();

  const people = useMemo(() => PEOPLE.map((p) => ({ ...p, name: tx(p.name) })), [tx]);
  const [q, setQState] = useState(() => persona.name);
  const [searching, setSearching] = useState(false);
  const [focus, setFocus] = useState(false);
  const [typed, setTyped] = useState(0);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [claim, setClaim] = useState<Claim>(null);
  const [openPct, setOpenPct] = useState(0);

  const sTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const raf = useRef<number | undefined>(undefined);

  // NORA's typed greeting.
  useEffect(() => {
    if (prefersReducedMotion()) {
      setTyped(GREETING.length);
      return;
    }
    const iv = setInterval(() => {
      setTyped((t) => {
        if (t >= GREETING.length) {
          clearInterval(iv);
          return t;
        }
        return t + 2;
      });
    }, 28);
    return () => clearInterval(iv);
  }, []);

  useEffect(
    () => () => {
      clearTimeout(sTimer.current);
      clearTimeout(toTimer.current);
      clearTimeout(cTimer.current);
      if (raf.current !== undefined) cancelAnimationFrame(raf.current);
    },
    [],
  );

  const toast = (m: string) => (e?: SyntheticEvent) => {
    e?.preventDefault();
    setToastMsg(m);
    clearTimeout(toTimer.current);
    toTimer.current = setTimeout(() => setToastMsg(null), 2200);
  };

  const setQ = (v: string) => {
    setQState(v);
    setSearching(!!v.trim());
    clearTimeout(sTimer.current);
    sTimer.current = setTimeout(() => setSearching(false), 550);
  };

  const signIn = () => {
    setClaim("opening");
    setOpenPct(0);
    raf.current = requestAnimationFrame(() => {
      raf.current = requestAnimationFrame(() => setOpenPct(100));
    });
    clearTimeout(cTimer.current);
    cTimer.current = setTimeout(() => hfNav("interview"), prefersReducedMotion() ? 300 : 1600);
  };

  const closeClaim = (e?: SyntheticEvent) => {
    e?.preventDefault();
    if (claim === "idle") setClaim(null);
  };

  const res = match(q, people);
  const typing = typed < GREETING.length;
  const showResults = !searching && res.length > 0;
  const noResults = !searching && !!q.trim() && res.length === 0;
  const countLabel = `${res.length} profile${res.length === 1 ? "" : "s"} match this search`;
  const noop = toast("Outside this demo");

  const avPx = isD ? 56 : 48;
  const segW = isD ? 40 : 22;
  const searchIc = isD ? 26 : 22;
  const faceSize = isD ? 56 : 44;
  const dlgPos: CSSProperties = isD
    ? {
        left: "50%",
        top: "50%",
        transform: "translate(-50%,-50%)",
        width: 520,
        maxHeight: "calc(100% - 48px)",
      }
    : { left: 0, right: 0, bottom: 0, maxHeight: "94%" };

  const seg = (on: boolean): CSSProperties => ({
    width: segW,
    height: 5,
    borderRadius: 3,
    ...(on ? { backgroundImage: CTA_GRAD } : { background: "oklch(0.9 0.01 285)" }),
  });

  const ctaBtn: CSSProperties = {
    flex: "none",
    height: 48,
    border: "none",
    borderRadius: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    font: "700 15px Manrope,sans-serif",
    color: "#fff",
    cursor: "pointer",
    backgroundImage: CTA_GRAD,
    boxShadow: "0 8px 20px oklch(0.5108 0.2385 296.5 / 0.3)",
    marginTop: 2,
  };

  let claimNode: ReactNode = null;
  if (claim) {
    claimNode = (
      <>
        <div
          onClick={() => closeClaim()}
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 40,
            background: "rgba(18,28,48,.55)",
            backdropFilter: "blur(3px)",
            WebkitBackdropFilter: "blur(3px)",
            animation: "hf-fadeIn .2s ease both",
          }}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Claim your profile"
          style={{
            position: "absolute",
            zIndex: 41,
            ...dlgPos,
            display: "flex",
            flexDirection: "column",
            background: "#fff",
            borderRadius: isD ? 20 : "24px 24px 0 0",
            boxShadow: "0 32px 80px rgba(10,20,40,.4)",
            overflow: "hidden",
            animation: isD
              ? "hf-dlgIn .28s ease both"
              : "hf-sheetIn .32s cubic-bezier(.2,.8,.2,1) both",
          }}
        >
          <div
            style={{
              flex: "none",
              background: NAVY,
              backgroundImage: `radial-gradient(80% 120% at 100% 0%,oklch(0.5108 0.2385 296.5 / 0.4),transparent 65%),radial-gradient(70% 120% at 0% 100%,oklch(0.5798 0.204 259.1 / 0.3),transparent 65%)`,
              color: "#fff",
              overflow: "hidden",
              maxHeight: claim === "opening" ? "0px" : "160px",
              opacity: claim === "opening" ? 0 : 1,
              transition: "max-height .6s cubic-bezier(.6,0,.2,1),opacity .4s ease",
            }}
          >
            <div
              style={{
                position: "relative",
                padding: isD ? "18px 24px" : "10px 20px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {isM ? (
                <span
                  style={{
                    width: 40,
                    height: 4,
                    borderRadius: 2,
                    background: "rgba(255,255,255,.3)",
                    margin: "0 auto 2px",
                  }}
                />
              ) : null}
              {isD ? (
                <Hov
                  onClick={() => closeClaim()}
                  aria-label="Close"
                  style={{
                    position: "absolute",
                    top: 14,
                    right: 14,
                    width: 30,
                    height: 30,
                    border: "none",
                    borderRadius: "50%",
                    background: "rgba(255,255,255,.1)",
                    color: "#fff",
                    cursor: "pointer",
                    display: "grid",
                    placeItems: "center",
                  }}
                  hover={{ background: "rgba(255,255,255,.2)" }}
                >
                  <svg
                    width={15}
                    height={15}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.2}
                    strokeLinecap="round"
                    aria-hidden
                  >
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </Hov>
              ) : null}
              <div style={{ display: "flex", alignItems: "center", gap: 14, paddingRight: 36 }}>
                <img
                  src={HF_ASSETS.samplePhoto}
                  alt=""
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: "50%",
                    objectFit: "cover",
                    objectPosition: "50% 22%",
                    flex: "none",
                    boxShadow: "0 0 0 3px rgba(255,255,255,.9)",
                  }}
                />
                <div
                  style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}
                >
                  <span style={{ font: "700 20px Sora,sans-serif", letterSpacing: "-0.02em" }}>
                    {persona.name}
                  </span>
                  <span
                    style={{
                      font: "500 13px/1.45 Manrope,sans-serif",
                      color: "rgba(255,255,255,.78)",
                    }}
                  >
                    Senior Loan Officer · Demo Mortgage Co · Davenport, IA
                  </span>
                </div>
              </div>
            </div>
          </div>

          {claim === "idle" ? (
            <div
              style={{
                flex: "1 1 auto",
                minHeight: 0,
                padding: isD ? "18px 28px 20px" : "16px 20px 20px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                overflow: "auto",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    font: "600 13px Manrope,sans-serif",
                    color: "#5f6368",
                  }}
                >
                  <span>Step 2 of 3</span>
                  <span style={{ color: "#9aa0a6" }}>Claim</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: "oklch(0.92 0.01 285)" }}>
                  <div
                    style={{ width: "66%", height: 6, borderRadius: 3, backgroundImage: CTA_GRAD }}
                  />
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 4 }}>
                <h2
                  style={{
                    margin: 0,
                    font: `700 ${isD ? "28px" : "24px"}/1.15 Sora,sans-serif`,
                    letterSpacing: "-0.03em",
                    color: INK,
                  }}
                >
                  Claim your profile
                </h2>
                <p style={{ margin: 0, font: "500 15px/1.5 Manrope,sans-serif", color: "#5f6368" }}>
                  NORA checks your licence during setup — nothing else is needed now.
                </p>
              </div>
              <Hov onClick={signIn} style={ctaBtn} hover={{ filter: "brightness(1.08)" }}>
                <span
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: "#fff",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  <GoogleMark />
                </span>
                Continue with Google
              </Hov>
              {SSO_ALT.map(([n, k]) => (
                <Hov
                  key={k}
                  onClick={signIn}
                  style={{
                    flex: "none",
                    height: 44,
                    border: "1px solid #e3e5e8",
                    borderRadius: 12,
                    background: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 12,
                    font: "600 15px Manrope,sans-serif",
                    color: INK,
                    cursor: "pointer",
                  }}
                  hover={{ background: "#f8f9fa", borderColor: "#d2d5d9" }}
                >
                  <SsoMark k={k} />
                  <span>Continue with {n}</span>
                </Hov>
              ))}
              <a
                href="#"
                onClick={closeClaim}
                style={{
                  alignSelf: "center",
                  font: "600 14px Manrope,sans-serif",
                  padding: "6px 0 2px",
                }}
              >
                This isn't me
              </a>
            </div>
          ) : null}

          {claim === "opening" ? (
            <div
              style={{
                padding: isD ? "48px 28px 44px" : "40px 20px 48px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 18,
                textAlign: "center",
                fontFamily: "Arial,Helvetica,sans-serif",
                animation: "hf-rise10 .4s ease .2s both",
              }}
            >
              <div style={{ position: "relative" }}>
                <NoraFace size={72} mood="working" shadow={NORA_SHADOW} />
                <span
                  style={{
                    position: "absolute",
                    inset: -10,
                    borderRadius: "50%",
                    border: "2px solid #9b72f2",
                    opacity: 0.35,
                    animation: "hf-pulseRing 1.6s ease-out infinite",
                  }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span
                  style={{
                    font: "700 11px Arial,sans-serif",
                    letterSpacing: ".14em",
                    color: "#7b4ce0",
                  }}
                >
                  NORA
                </span>
                <span role="status" style={{ font: "600 20px Arial,sans-serif", color: "#202124" }}>
                  Opening your record…
                </span>
              </div>
              <div
                style={{
                  width: 200,
                  height: 4,
                  borderRadius: 2,
                  background: "#ece4fc",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${openPct}%`,
                    background: "#9b72f2",
                    transition: "width 1.4s linear",
                  }}
                />
              </div>
            </div>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <div className="hf-root hf-discovery">
      <div
        style={{
          borderRadius: framed ? 24 : 0,
          background: framed ? "#e8eaed" : "#fff",
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
            borderRadius: framed ? "28px" : "0",
            boxShadow: framed ? "0 20px 60px rgba(32,33,36,.22), 0 0 0 1px #dadce0" : "none",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            backgroundImage:
              "radial-gradient(120% 90% at 0% 0%,oklch(0.965 0.021 30) 0%,transparent 55%),radial-gradient(110% 90% at 100% 0%,oklch(0.955 0.025 285) 0%,transparent 55%),linear-gradient(180deg,oklch(0.985 0.004 285),#fff)",
          }}
        >
          {/* Banner */}
          <div
            style={{
              flex: "none",
              background: NAVY,
              backgroundImage:
                "radial-gradient(60% 140% at 50% 0%,oklch(0.5108 0.2385 296.5 / 0.35),transparent 70%)",
              color: "#fff",
            }}
          >
            <div
              style={{
                maxWidth: 1200,
                margin: "0 auto",
                padding: isD ? "10px 24px" : "12px 16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: isD ? 14 : 8,
                flexDirection: isD ? "row" : "column",
                textAlign: "center",
              }}
            >
              <p
                style={{
                  margin: 0,
                  font: `600 ${isD ? "14px" : "13px"}/1.4 Manrope,sans-serif`,
                  color: "rgba(255,255,255,.9)",
                }}
              >
                See how thousands of professionals rank{" "}
                <span
                  style={{
                    fontWeight: 800,
                    backgroundImage:
                      "linear-gradient(100deg,oklch(0.78 0.15 296.5),oklch(0.8 0.13 259.1))",
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    color: "transparent",
                  }}
                >
                  #1
                </span>{" "}
                on Google
              </p>
              <Hov
                as="a"
                href="#"
                onClick={toast("Plays the 60-second explainer")}
                style={{
                  flex: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  height: 30,
                  borderRadius: 999,
                  background: "rgba(255,255,255,.12)",
                  border: "1px solid rgba(255,255,255,.22)",
                  padding: "0 12px 0 6px",
                  font: "700 13px Manrope,sans-serif",
                  color: "#fff",
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
                hover={{
                  background: "rgba(255,255,255,.2)",
                  color: "#fff",
                  textDecoration: "none",
                }}
              >
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: "#fff",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  <svg width={9} height={9} viewBox="0 0 24 24" fill={NAVY} aria-hidden>
                    <path d="M7 4v16l13-8z" />
                  </svg>
                </span>
                See how it works
              </Hov>
            </div>
          </div>

          {/* Header */}
          <header
            style={{
              flex: "none",
              height: isD ? 76 : 60,
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: isD ? "0 48px" : "0 16px",
              maxWidth: 1440,
              width: "100%",
              margin: "0 auto",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <img
                src={HF_ASSETS.experienceIcon}
                alt=""
                style={{ width: isD ? 22 : 18, height: "auto" }}
              />
              <span
                style={{
                  font: `700 ${isD ? "20px" : "17px"} Sora,sans-serif`,
                  letterSpacing: "-0.02em",
                  color: "#12294d",
                }}
              >
                experience.com
              </span>
            </div>
            <div
              style={{
                marginLeft: "auto",
                display: "flex",
                alignItems: "center",
                gap: 10,
                font: "600 13px Manrope,sans-serif",
                color: "#5f6368",
                whiteSpace: "nowrap",
              }}
            >
              <span>Step 1 of 3</span>
              <div style={{ display: "flex", gap: 4 }}>
                <span style={seg(true)} />
                <span style={seg(false)} />
                <span style={seg(false)} />
              </div>
            </div>
          </header>

          {/* Body */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "auto",
              display: "flex",
              justifyContent: "center",
              alignItems: "flex-start",
              padding: isD ? "24px 48px 48px" : "8px 16px 32px",
            }}
          >
            <div
              style={{
                width: "100%",
                maxWidth: 720,
                display: "flex",
                flexDirection: "column",
                gap: isD ? 24 : 18,
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: isD ? 16 : 12,
                  alignItems: "flex-start",
                  animation: "hf-rise10 .4s ease both",
                }}
              >
                <NoraFace size={faceSize} mood={typing ? "working" : "idle"} shadow={NORA_SHADOW} />
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    paddingTop: 2,
                  }}
                >
                  <span
                    style={{
                      font: "700 11px Manrope,sans-serif",
                      letterSpacing: ".14em",
                      color: VIOLET,
                    }}
                  >
                    NORA
                  </span>
                  <div
                    aria-label={GREETING}
                    style={{
                      font: `500 ${isD ? "18px" : "15px"}/1.5 Manrope,sans-serif`,
                      color: "#3c4043",
                      minHeight: isD ? 54 : 68,
                      textWrap: "pretty",
                    }}
                  >
                    {GREETING.slice(0, typed)}
                    {typing ? (
                      <span
                        style={{
                          display: "inline-block",
                          width: 2,
                          height: "1em",
                          marginLeft: 2,
                          verticalAlign: -3,
                          background: VIOLET,
                          animation: "hf-caret 1s steps(1) infinite",
                        }}
                      />
                    ) : null}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <h1
                  style={{
                    margin: 0,
                    font: `700 ${isD ? "48px" : "32px"}/1.08 Sora,sans-serif`,
                    letterSpacing: "-0.03em",
                  }}
                >
                  Let's find you
                </h1>
                <p
                  style={{
                    margin: 0,
                    font: `500 ${isD ? "18px" : "16px"} Manrope,sans-serif`,
                    color: "#5f6368",
                  }}
                >
                  We'll look for your existing profile.
                </p>
              </div>

              <div
                style={{
                  flex: "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  height: isD ? 76 : 64,
                  borderRadius: 16,
                  background: "#fff",
                  border: `2px solid ${focus ? BLUE : "oklch(0.5798 0.204 259.1 / 0.3)"}`,
                  padding: isD ? "0 12px 0 24px" : "0 10px 0 18px",
                  boxShadow: "0 12px 32px rgba(66,133,244,.12),0 4px 12px rgba(60,64,67,.06)",
                  transition: "border-color .2s",
                }}
              >
                <svg
                  width={searchIc}
                  height={searchIc}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={BLUE}
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  style={{ flex: "none" }}
                  aria-hidden
                >
                  <circle cx={11} cy={11} r={7} />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onFocus={() => setFocus(true)}
                  onBlur={() => setFocus(false)}
                  placeholder="Your full name"
                  aria-label="Your full name"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    font: `600 ${isD ? "22px" : "19px"} Manrope,sans-serif`,
                    color: INK,
                  }}
                />
              </div>

              {searching ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {[1, 2, 3].map((x) => (
                    <div
                      key={x}
                      style={{
                        height: isD ? 92 : 84,
                        borderRadius: 14,
                        background: "linear-gradient(90deg,#fff 0%,#f4f5fa 50%,#fff 100%)",
                        backgroundSize: "200% 100%",
                        animation: "hf-sweep 1.4s linear infinite",
                        boxShadow: "0 4px 12px rgba(66,133,244,.06)",
                      }}
                    />
                  ))}
                </div>
              ) : null}

              {showResults ? (
                <>
                  <div style={{ font: "700 13px Manrope,sans-serif", color: "#5f6368" }}>
                    {countLabel}
                  </div>
                  {res.map((r, i) => (
                    <Hov
                      as="div"
                      key={r.id}
                      style={{
                        position: "relative",
                        borderRadius: 14,
                        backgroundImage: "linear-gradient(#fff,#fff),linear-gradient(#fff,#fff)",
                        backgroundOrigin: "border-box",
                        backgroundClip: "padding-box,border-box",
                        border: "1.5px solid #eceef1",
                        boxShadow: "0 4px 12px rgba(66,133,244,.08),0 2px 4px rgba(60,64,67,.04)",
                        transition: "transform .18s,box-shadow .18s",
                        animation: `hf-rise10 .35s ease ${i * 70}ms both`,
                      }}
                      hover={{
                        transform: "translateY(-2px)",
                        boxShadow: "0 12px 28px rgba(66,133,244,.14)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: isD ? 16 : 12,
                          padding: isD ? "16px 18px" : "14px",
                        }}
                      >
                        <img
                          src={r.photo}
                          alt=""
                          style={{
                            width: avPx,
                            height: avPx,
                            borderRadius: "50%",
                            objectFit: "cover",
                            objectPosition: r.pos,
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
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              flexWrap: "wrap",
                            }}
                          >
                            <span
                              style={{ font: `600 ${isD ? "17px" : "16px"} Manrope,sans-serif` }}
                            >
                              {r.name}
                            </span>
                            <span
                              style={{
                                font: "700 11px Manrope,sans-serif",
                                color: "oklch(0.48 0.12 70)",
                                background: "oklch(0.96 0.05 85)",
                                borderRadius: 999,
                                padding: "2px 8px",
                                whiteSpace: "nowrap",
                              }}
                            >
                              Unclaimed
                            </span>
                          </div>
                          <span
                            style={{
                              font: `500 ${isD ? "14px" : "13px"} Manrope,sans-serif`,
                              color: "#5f6368",
                            }}
                          >
                            {r.title}
                          </span>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              font: "500 13px Manrope,sans-serif",
                              color: "#80868b",
                            }}
                          >
                            <svg
                              width={12}
                              height={12}
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={2.2}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden
                            >
                              <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                              <circle cx={12} cy={10} r={3} />
                            </svg>
                            {r.city}
                          </span>
                        </div>
                        <Hov
                          onClick={
                            r.likely
                              ? () => {
                                  setClaim("idle");
                                  setOpenPct(0);
                                }
                              : toast(tx("The demo follows Alex in Davenport"))
                          }
                          style={{
                            flex: "none",
                            height: isD ? 42 : 38,
                            border: "none",
                            borderRadius: 999,
                            padding: isD ? "0 22px" : "0 16px",
                            font: "700 14px Manrope,sans-serif",
                            color: "#fff",
                            cursor: "pointer",
                            backgroundImage: CTA_GRAD,
                            boxShadow: "0 6px 16px oklch(0.5108 0.2385 296.5 / 0.28)",
                          }}
                          hover={{ filter: "brightness(1.08)" }}
                        >
                          Claim
                        </Hov>
                      </div>
                    </Hov>
                  ))}
                </>
              ) : null}

              {noResults ? (
                <div
                  style={{
                    borderRadius: 14,
                    background: "#fff",
                    padding: 18,
                    font: "500 14px Manrope,sans-serif",
                    color: "#5f6368",
                    boxShadow: "0 4px 12px rgba(66,133,244,.06)",
                  }}
                >
                  No profiles match that name yet. Try your full name, or{" "}
                  <a href="#" onClick={noop}>
                    create a new one
                  </a>
                  .
                </div>
              ) : null}

              <div
                style={{
                  font: "500 14px Manrope,sans-serif",
                  color: "#5f6368",
                  textAlign: "center",
                  paddingBottom: 8,
                }}
              >
                Already have a profile?{" "}
                <a href="#" onClick={noop}>
                  Log In
                </a>{" "}
                or{" "}
                <a href="#" onClick={noop}>
                  Create a new one
                </a>
                .
              </div>
            </div>
          </div>

          {claimNode}

          {toastMsg ? (
            <div
              role="status"
              style={{
                position: "absolute",
                left: "50%",
                bottom: 24,
                transform: "translateX(-50%)",
                zIndex: 60,
                borderRadius: 10,
                background: NAVY,
                padding: "11px 16px",
                font: "600 13px Manrope,sans-serif",
                color: "#fff",
                boxShadow: "0 8px 24px rgba(0,0,0,.25)",
                whiteSpace: "nowrap",
              }}
            >
              {toastMsg}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
