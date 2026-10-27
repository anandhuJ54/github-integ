/**
 * Shared visual primitives for the Happyflow prototype screens (NORA blob, score ring, icons,
 * hover-aware elements). Ported 1:1 from the Claude Design prototype so every screen renders
 * the same NORA and the same gauge.
 */
import {
  createElement,
  useEffect,
  useState,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from "react";
import { HF_ICONS, type HfIconName } from "./icons";

export const GEMINI = "linear-gradient(135deg,#4285f4 0%,#9b72f2 35%,#ea4335 65%,#fbbc04 100%)";
export const RIBBON =
  "linear-gradient(90deg,#4285f4 0%,#9b72f2 25%,#ea4335 50%,#fbbc04 75%,#34a853 100%)";
/** The soft pink / blue corner wash used behind hero cards. */
export const PEARL =
  "radial-gradient(120% 90% at 0% 0%,oklch(0.965 0.021 30) 0%,transparent 55%),radial-gradient(110% 90% at 100% 0%,oklch(0.955 0.025 285) 0%,transparent 55%),linear-gradient(180deg,oklch(0.985 0.004 285),#fff)";
/** Page background: pearl with pink, blue, green and purple corner washes. */
export const PAGE_WASH =
  "radial-gradient(60% 40% at 0% 0%,#fde4ee 0%,transparent 60%),radial-gradient(55% 40% at 100% 0%,#dde8fd 0%,transparent 60%),radial-gradient(60% 45% at 100% 100%,#e2f4ea 0%,transparent 60%),radial-gradient(55% 40% at 0% 100%,#ece4fc 0%,transparent 60%)";
/** Colours of the orbiting fact dots around the score ring. */
export const DOTC = [
  "#4285f4",
  "#ea4335",
  "#fbbc04",
  "#34a853",
  "#4285f4",
  "#4285f4",
  "#4285f4",
  "#ea4335",
  "#fbbc04",
  "#9b72f2",
  "#34a853",
  "#4285f4",
  "#fbbc04",
  "#ea4335",
  "#ea4335",
  "#ea4335",
  "#ea4335",
  "#ea4335",
  "#9b72f2",
  "#9b72f2",
  "#9b72f2",
  "#ea4335",
  "#ea4335",
  "#ea4335",
  "#ea4335",
  "#ea4335",
];

export function useReducedMotion() {
  const [rm, setRm] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setRm(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return rm;
}

/** Imperative check for timers/handlers (same as the prototype's `rm()`). */
export function prefersReducedMotion() {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function Ic({
  name,
  size = 16,
  color = "currentColor",
  sw = 2,
  style,
}: {
  name: HfIconName;
  size?: number;
  color?: string;
  sw?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, display: "block", ...style }}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: HF_ICONS[name] }}
    />
  );
}

export function Tick({ size = 12, color = "#fff" }: { size?: number; color?: string }) {
  return <Ic name="check" size={size} color={color} sw={3.5} />;
}

export type NoraMood = "idle" | "working" | "done";

/** NORA: a morphing Gemini-gradient blob with two eyes. */
export function NoraFace({
  size,
  mood = "idle",
  shadow = "0 4px 14px rgba(155,114,242,.3)",
  burstKey,
}: {
  size: number;
  mood?: NoraMood;
  shadow?: string;
  /** Change to replay the green "done" burst. */
  burstKey?: string | number;
}) {
  const rm = useReducedMotion();
  const s = size;
  const eye: CSSProperties = {
    width: s * 0.12,
    height: s * 0.2,
    borderRadius: s,
    background: "#fff",
    animation: !rm && mood === "idle" ? "hf-nBlink 4s ease-in-out infinite" : "none",
  };
  const anim = rm
    ? "none"
    : mood === "working"
      ? "hf-nMorph 3s ease-in-out infinite, hf-nDrift 2.4s ease infinite"
      : "hf-nMorph 10s ease-in-out infinite, hf-nDrift 8s ease infinite";
  return (
    <span style={{ position: "relative", width: s, height: s, flexShrink: 0, display: "block" }}>
      <span
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "42% 58% 63% 37%/45% 40% 60% 55%",
          background: GEMINI,
          backgroundSize: "200% 200%",
          animation: anim,
          display: "grid",
          placeItems: "center",
          boxShadow: shadow,
          overflow: "hidden",
        }}
      >
        <span
          style={{
            position: "absolute",
            left: "16%",
            top: "10%",
            width: "46%",
            height: "30%",
            borderRadius: "50%",
            background:
              "radial-gradient(ellipse at center,rgba(255,255,255,.55),rgba(255,255,255,0) 70%)",
          }}
        />
        {mood === "done" ? (
          <svg
            width={s * 0.5}
            height={s * 0.3}
            viewBox="0 0 20 12"
            fill="none"
            stroke="#fff"
            strokeWidth={2.4}
            strokeLinecap="round"
            style={{ position: "relative" }}
          >
            <path d="M2 8 Q5 3 8 8" />
            <path d="M12 8 Q15 3 18 8" />
          </svg>
        ) : (
          <span
            style={{
              position: "relative",
              display: "flex",
              gap: s * 0.14,
              animation: !rm && mood === "working" ? "hf-nLook 1.6s ease-in-out infinite" : "none",
            }}
          >
            <span style={eye} />
            <span style={eye} />
          </span>
        )}
      </span>
      {mood === "done" && !rm ? (
        <span
          key={burstKey}
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            border: "2px solid #34a853",
            animation: "hf-nBurst .8s ease-out 2 both",
          }}
        />
      ) : null}
    </span>
  );
}

/**
 * The Search Rank Score ring: red → amber → green semicircle with a triangle marker, inside two
 * slowly orbiting rings of coloured fact dots.
 */
export function ScoreRing({
  px,
  ns,
  value,
  label = "/ 850",
  dots = DOTC.length,
  id = "hfRing",
  max = 850,
}: {
  px: number;
  /** Number font size in SVG units. */
  ns: number;
  value: number;
  label?: string;
  dots?: number;
  /** Gradient id; must be unique on the page. */
  id?: string;
  /** What the full arc stands for; null draws no progress (an unknown maximum). */
  max?: number | null;
}) {
  const rm = useReducedMotion();
  const p = max ? Math.max(0, Math.min(1, value / max)) : 0;
  const L = Math.PI * 40;
  const th = Math.PI * (1 - p);
  const R = 50;
  const mx = 70 + R * Math.cos(th);
  const my = 70 - R * Math.sin(th);
  const rot = 90 - (th * 180) / Math.PI;
  const rings: ReactNode[][] = [[], []];
  for (let i = 0; i < Math.min(dots, DOTC.length); i++) {
    const k = i % 2;
    const r = k ? 58 : 66;
    const a = ((Math.floor(i / 2) * 137.508 + (k ? 60 : 0)) * Math.PI) / 180;
    rings[k].push(
      <circle
        key={i}
        cx={+(70 + r * Math.cos(a)).toFixed(2)}
        cy={+(70 + r * Math.sin(a)).toFixed(2)}
        r={3.2}
        fill={DOTC[i]}
        stroke="#fff"
        strokeWidth={1.2}
        style={{
          transformBox: "fill-box",
          transformOrigin: "center",
          animation: rm ? "none" : `hf-dotIn .5s cubic-bezier(.2,.8,.2,1) ${i * 30}ms both`,
        }}
      />,
    );
  }
  const orbit = (k: 0 | 1, r: number, anim: string) => (
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
      {rings[k]}
    </g>
  );
  const arc = "M30 70 A40 40 0 0 1 110 70";
  const ny = 70 + ns * 0.42;
  return (
    <span style={{ position: "relative", width: px, height: px, flexShrink: 0, display: "block" }}>
      <svg
        viewBox="0 0 140 140"
        width={px}
        height={px}
        style={{ display: "block", overflow: "visible" }}
      >
        <defs>
          <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={30} y1={0} x2={110} y2={0}>
            <stop offset={0} stopColor="#ea4335" />
            <stop offset={0.5} stopColor="#fbbc04" />
            <stop offset={1} stopColor="#34a853" />
          </linearGradient>
        </defs>
        <circle cx={70} cy={70} r={62} fill="rgba(255,255,255,.95)" />
        {orbit(0, 66, "hf-orbit 90s linear infinite")}
        {orbit(1, 58, "hf-orbitR 120s linear infinite")}
        <path
          d={arc}
          fill="none"
          stroke={`url(#${id})`}
          strokeOpacity={0.2}
          strokeWidth={9}
          strokeLinecap="round"
        />
        <path
          d={arc}
          fill="none"
          stroke={`url(#${id})`}
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
          y={ny}
          textAnchor="middle"
          style={{
            font: `700 ${ns}px Arial, sans-serif`,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-1px",
            fill: "#202124",
          }}
        >
          {String(value)}
        </text>
        <text
          x={70}
          y={ny + 14}
          textAnchor="middle"
          style={{ font: "700 9px Arial, sans-serif", fill: "#80868b", letterSpacing: "1.5px" }}
        >
          {label}
        </text>
      </svg>
    </span>
  );
}

/** Small amber semicircle used for website health (40 of 102). */
export function HealthGauge({
  px,
  value = 40,
  max = 102,
}: {
  px: number;
  value?: number;
  max?: number;
}) {
  const p = value / max;
  const L = Math.PI * 50;
  return (
    <svg viewBox="0 0 120 70" width={px} height={(px * 70) / 120} style={{ display: "block" }}>
      <path
        d="M10 62 A50 50 0 0 1 110 62"
        fill="none"
        stroke="#eceef1"
        strokeWidth={10}
        strokeLinecap="round"
      />
      <path
        d="M10 62 A50 50 0 0 1 110 62"
        fill="none"
        stroke="#fbbc04"
        strokeWidth={10}
        strokeLinecap="round"
        strokeDasharray={`${(p * L).toFixed(1)} 400`}
      />
      <text
        x={60}
        y={54}
        textAnchor="middle"
        style={{ font: "700 28px Arial, sans-serif", fill: "#202124" }}
      >
        {value}
      </text>
      <text
        x={60}
        y={68}
        textAnchor="middle"
        style={{ font: "700 8px Arial, sans-serif", fill: "#80868b", letterSpacing: "1px" }}
      >
        OF {max}
      </text>
    </svg>
  );
}

type HovProps = {
  as?: ElementType;
  style?: CSSProperties;
  /** Styles merged in while hovered (the prototype's `style-hover`). */
  hover?: CSSProperties;
  children?: ReactNode;
} & Record<string, unknown>;

/** An element that applies `hover` styles on pointer hover, for the prototype's hover states. */
export function Hov({ as = "button", style, hover, children, ...rest }: HovProps) {
  const [on, setOn] = useState(false);
  const extra: Record<string, unknown> = {};
  if (as === "button" && rest.type === undefined) extra.type = "button";
  return createElement(
    as,
    {
      ...extra,
      ...rest,
      style: on && hover ? { ...style, ...hover } : style,
      onMouseEnter: () => setOn(true),
      onMouseLeave: () => setOn(false),
    },
    children,
  );
}

/** Orange "PRO" pill — marks features that need a paid plan (matches the main app's sidebar). */
export function ProBadge({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 999,
        background: "#f97316",
        padding: size === "sm" ? "1px 7px" : "2px 9px",
        font: `700 ${size === "sm" ? 9 : 10}px Arial,sans-serif`,
        letterSpacing: ".06em",
        color: "#fff",
        verticalAlign: "middle",
        whiteSpace: "nowrap",
      }}
    >
      PRO
    </span>
  );
}
