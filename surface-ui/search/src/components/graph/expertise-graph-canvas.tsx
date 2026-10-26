import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus, Crosshair } from "lucide-react";
import {
  BRANCHES,
  branchMeta,
  branchOf,
  nodeLabel,
  type BranchKey,
  type ExpertiseGraphData,
  type GraphNode,
} from "@v3/search/utils/expertise-graph";

type Placed = {
  id: string;
  kind: "root" | "hub" | "leaf";
  label: string;
  branch: BranchKey;
  color: string;
  x: number;
  y: number;
  r: number;
  angle: number;
  data?: GraphNode;
  verified?: boolean | null;
  structural?: boolean;
};

const WIDTH = 1200;
const HEIGHT = 780;
const CX = WIDTH / 2;
const CY = HEIGHT / 2;
const HUB_R = 190;

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/**
 * Deterministic radial layout: the entity at the centre, one hub per branch on an
 * inner orbit, and that branch's live nodes fanned outward inside its own sector.
 * Deterministic geometry keeps labels legible and the picture stable between loads.
 */
function layout(graph: ExpertiseGraphData) {
  const byBranch = new Map<BranchKey, GraphNode[]>();
  for (const n of graph.nodes) {
    const b = n.branch ?? branchOf(n);
    const arr = byBranch.get(b) ?? [];
    arr.push(n);
    byBranch.set(b, arr);
  }

  const nodes: Placed[] = [
    {
      id: "__root__",
      kind: "root",
      label: graph.entity.name,
      branch: "identity",
      color: "#ffffff",
      x: CX,
      y: CY,
      r: 40,
      angle: 0,
    },
  ];
  const links: { id: string; from: string; to: string; color: string; strong: boolean }[] = [];

  const active = BRANCHES.filter((b) => (byBranch.get(b.key)?.length ?? 0) > 0 || b.key === "identity");
  const step = (Math.PI * 2) / Math.max(active.length, 1);

  active.forEach((b, bi) => {
    const base = -Math.PI / 2 + bi * step;
    const hubId = `hub:${b.key}`;
    nodes.push({
      id: hubId,
      kind: "hub",
      label: b.label,
      branch: b.key,
      color: b.color,
      x: CX + Math.cos(base) * HUB_R,
      y: CY + Math.sin(base) * HUB_R,
      r: 16,
      angle: base,
    });
    links.push({ id: `l:${hubId}`, from: "__root__", to: hubId, color: b.color, strong: true });

    const items = (byBranch.get(b.key) ?? []).slice(0, 48);
    const spread = step * 0.82;
    const perArc = 5;
    items.forEach((n, i) => {
      const layer = Math.floor(i / perArc);
      const inLayer = i % perArc;
      const countThis = Math.min(perArc, items.length - layer * perArc);
      const t = countThis === 1 ? 0 : inLayer / (countThis - 1) - 0.5;
      const a = base + t * spread * (1 - layer * 0.12);
      const rad = HUB_R + 130 + layer * 92;
      const leafId = n.id;
      nodes.push({
        id: leafId,
        kind: "leaf",
        label: nodeLabel(n),
        branch: b.key,
        color: b.color,
        x: CX + Math.cos(a) * rad,
        y: CY + Math.sin(a) * rad,
        r: n.verified ? 10 : 8,
        angle: a,
        data: n,
        verified: n.verified,
        structural: n.structural,
      });
      links.push({ id: `l:${hubId}:${leafId}`, from: hubId, to: leafId, color: b.color, strong: false });
    });
  });

  return { nodes, links };
}

export function ExpertiseGraphCanvas({
  graph,
  onSelect,
  selectedId,
}: {
  graph: ExpertiseGraphData;
  onSelect: (node: GraphNode | null) => void;
  selectedId: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [hovered, setHovered] = useState<string | null>(null);
  const [reveal, setReveal] = useState(0);

  const { nodes, links } = useMemo(() => layout(graph), [graph]);

  const byId = useMemo(() => {
    const m = new Map<string, Placed>();
    nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [nodes]);

  // Gentle grow-in so the object feels alive on first render.
  useEffect(() => {
    setReveal(0);
    let frame = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = clamp((t - start) / 700, 0, 1);
      setReveal(clamp(1 - Math.pow(1 - p, 3), 0, 1));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [nodes]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      const cur = viewRef.current;
      const next = clamp(cur.k * Math.exp(-dy * 0.0015), 0.4, 3.5);
      const ratio = next / cur.k;
      setView({
        k: next,
        x: px - (px - cur.x) * ratio,
        y: py - (py - cur.y) * ratio,
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const dragRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  const zoomBy = (factor: number) => {
    const cur = viewRef.current;
    const next = clamp(cur.k * factor, 0.4, 3.5);
    const ratio = next / cur.k;
    const cx = (containerRef.current?.clientWidth ?? WIDTH) / 2;
    const cy = (containerRef.current?.clientHeight ?? HEIGHT) / 2;
    setView({ k: next, x: cx - (cx - cur.x) * ratio, y: cy - (cy - cur.y) * ratio });
  };

  const hoveredNode = hovered ? byId.get(hovered) : null;
  const focusBranch = hoveredNode?.branch ?? null;

  const pos = (n: Placed) => ({
    x: CX + (n.x - CX) * reveal,
    y: CY + (n.y - CY) * reveal,
  });

  return (
    <div
      ref={containerRef}
      className="relative h-[74vh] min-h-[560px] w-full cursor-grab overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(ellipse_at_center,rgba(56,189,248,0.12),rgba(2,6,23,0)_62%)] active:cursor-grabbing"
      style={{ touchAction: "none" }}
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture?.(e.pointerId);
        dragRef.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
      }}
      onPointerMove={(e) => {
        const d = dragRef.current;
        if (!d) return;
        setView((v) => ({ ...v, x: d.vx + (e.clientX - d.x), y: d.vy + (e.clientY - d.y) }));
      }}
      onPointerUp={() => {
        dragRef.current = null;
      }}
      onPointerLeave={() => {
        dragRef.current = null;
        setHovered(null);
      }}
    >
      <svg width="100%" height="100%" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block">
        <defs>
          <radialGradient id="rootGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="60%" stopColor="#38bdf8" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
          </radialGradient>
          <filter id="softGlow" x="-70%" y="-70%" width="240%" height="240%">
            <feGaussianBlur stdDeviation="5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {[HUB_R, HUB_R + 130, HUB_R + 222, HUB_R + 314].map((r) => (
            <circle
              key={r}
              cx={CX}
              cy={CY}
              r={Math.max(0, r * reveal)}
              fill="none"
              stroke="rgba(148,163,184,0.12)"
              strokeDasharray="2 10"
            />
          ))}

          {links.map((l) => {
            const s = byId.get(l.from);
            const t = byId.get(l.to);
            if (!s || !t) return null;
            const sp = pos(s);
            const tp = pos(t);
            const dim = focusBranch && t.branch !== focusBranch;
            const mx = (sp.x + tp.x) / 2;
            const my = (sp.y + tp.y) / 2;
            const bend = 0.14;
            const qx = mx - (tp.y - sp.y) * bend;
            const qy = my + (tp.x - sp.x) * bend;
            return (
              <path
                key={l.id}
                d={`M ${sp.x} ${sp.y} Q ${qx} ${qy} ${tp.x} ${tp.y}`}
                fill="none"
                stroke={l.color}
                strokeOpacity={dim ? 0.08 : l.strong ? 0.55 : 0.28}
                strokeWidth={l.strong ? 2 : 1}
              />
            );
          })}

          {nodes.map((n) => {
            const p = pos(n);
            const dim = focusBranch && n.branch !== focusBranch && n.kind !== "root";
            const isFocused = hovered === n.id || selectedId === n.id;

            if (n.kind === "root") {
              return (
                <g key={n.id} transform={`translate(${p.x},${p.y})`}>
                  <circle r={92} fill="url(#rootGlow)" />
                  <circle r={n.r} fill="#0b1220" stroke="rgba(255,255,255,0.9)" strokeWidth={1.5} />
                  <text
                    y={5}
                    textAnchor="middle"
                    className="fill-white text-[12px] font-semibold tracking-wide"
                  >
                    {graph.entity.score != null ? graph.entity.score : "—"}
                  </text>
                  <text
                    y={n.r + 24}
                    textAnchor="middle"
                    className="fill-white text-[16px] font-semibold"
                  >
                    {n.label}
                  </text>
                  <text
                    y={n.r + 42}
                    textAnchor="middle"
                    className="fill-slate-400 text-[11px]"
                  >
                    Search Rank Score
                  </text>
                </g>
              );
            }

            if (n.kind === "hub") {
              const w = Math.max(96, n.label.length * 6.9 + 34);
              return (
                <g
                  key={n.id}
                  transform={`translate(${p.x},${p.y})`}
                  onMouseEnter={() => setHovered(n.id)}
                  onMouseLeave={() => setHovered(null)}
                  className="cursor-default"
                  opacity={dim ? 0.35 : 1}
                >
                  <rect
                    x={-w / 2}
                    y={-15}
                    width={w}
                    height={30}
                    rx={15}
                    fill="rgba(2,6,23,0.85)"
                    stroke={n.color}
                    strokeOpacity={0.7}
                  />
                  <circle cx={-w / 2 + 15} cy={0} r={4.5} fill={n.color} />
                  <text x={-w / 2 + 26} y={4} className="fill-slate-100 text-[11.5px] font-semibold">
                    {n.label}
                  </text>
                </g>
              );
            }

            return (
              <g
                key={n.id}
                transform={`translate(${p.x},${p.y})`}
                onMouseEnter={() => setHovered(n.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onSelect(n.data ?? null)}
                className="cursor-pointer"
                opacity={dim ? 0.22 : 1}
              >
                <circle
                  r={n.r + (isFocused ? 4 : 0)}
                  fill={n.color}
                  fillOpacity={n.structural ? 0.55 : 0.95}
                  stroke={isFocused ? "#ffffff" : n.color}
                  strokeOpacity={isFocused ? 1 : 0.6}
                  strokeWidth={isFocused ? 2 : 1}
                  filter={isFocused ? "url(#softGlow)" : undefined}
                />
                {n.verified ? (
                  <circle r={n.r + 5} fill="none" stroke={n.color} strokeOpacity={0.45} />
                ) : null}
                <text
                  x={Math.cos(n.angle) >= 0 ? n.r + 8 : -(n.r + 8)}
                  y={4}
                  textAnchor={Math.cos(n.angle) >= 0 ? "start" : "end"}
                  className={
                    isFocused
                      ? "fill-white text-[11px] font-semibold"
                      : "fill-slate-300 text-[10.5px]"
                  }
                >
                  {truncate(n.label, 30)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {hoveredNode && hoveredNode.kind !== "root" ? (
        <div className="pointer-events-none absolute bottom-4 left-4 max-w-[420px] rounded-lg border border-white/10 bg-slate-950/85 px-3 py-2 text-xs text-slate-200 backdrop-blur">
          <span className="font-semibold">{hoveredNode.label}</span>
          <span className="ml-2 text-slate-400">
            {branchMeta(hoveredNode.branch).label}
            {hoveredNode.structural ? " · from record" : ""}
          </span>
        </div>
      ) : null}

      <div className="absolute right-4 top-4 flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => zoomBy(1.25)}
          className="rounded-md border border-white/10 bg-slate-900/80 p-2 text-slate-200 backdrop-blur transition hover:bg-slate-800"
          aria-label="Zoom in"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => zoomBy(0.8)}
          className="rounded-md border border-white/10 bg-slate-900/80 p-2 text-slate-200 backdrop-blur transition hover:bg-slate-800"
          aria-label="Zoom out"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setView({ x: 0, y: 0, k: 1 })}
          className="rounded-md border border-white/10 bg-slate-900/80 p-2 text-slate-200 backdrop-blur transition hover:bg-slate-800"
          aria-label="Reset view"
        >
          <Crosshair className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
