import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowUp, BarChart3, DollarSign, Filter, TrendingDown, Trophy, Compass } from "lucide-react";
import { PageBody, PageHeader, Panel } from "@v3/ui/components/console/primitives";
import { BrandAvatar, PersonAvatar } from "@v3/ui/components/sales/entity-avatar";
import { Button } from "@v3/ui/components/ui/button";
import { loadScopeDashboard, type SalesScope, type ScopeDashboardData, type TeamLive } from "@v3/sales/lib/sales-spine";
import { loadActivity, type ActivityEvent } from "@v3/sales/lib/sales";

const nf = new Intl.NumberFormat("en-US");
const cf = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const label = (value: string) => value.replace(/^gcid:/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const format = (value: number | null, kind: "number" | "money" = "number") => value == null ? "—" : kind === "money" ? cf.format(value) : nf.format(value);
const pct = (num: number, den: number) => den > 0 ? `${((num / den) * 100).toFixed(1)}%` : "—";

type Period = "daily" | "weekly" | "monthly";
type Focus = "claims" | "revenue" | "pipeline" | "leaders" | "staffing";
type Series = { traffic: boolean; attempted: boolean; claimed: boolean };

const FOCUSES: { key: Focus; label: string; icon: typeof BarChart3 }[] = [
  { key: "claims", label: "Claims", icon: BarChart3 },
  { key: "revenue", label: "Revenue & Expansion", icon: DollarSign },
  { key: "pipeline", label: "Pipeline", icon: TrendingDown },
  { key: "leaders", label: "Leaderboards", icon: Trophy },
  { key: "staffing", label: "Staffing", icon: Compass },
];

export function ScopeDashboard({ scope }: { scope: SalesScope }) {
  const query = useQuery({ queryKey: ["sales-spine", scope.kind, scope.kind === "team" ? scope.teamId : "all"], queryFn: () => loadScopeDashboard(scope) });
  const [period, setPeriod] = useState<Period>("weekly");
  const [focus, setFocus] = useState<Focus>("claims");
  const [series, setSeries] = useState<Series>({ traffic: true, attempted: true, claimed: true });
  const activityQuery = useQuery({ queryKey: ["sales-activity", 30], queryFn: () => loadActivity(30) });
  const data = query.data;
  const suffix = scope.kind === "all" ? "all territories" : "this team";
  const chart = useMemo(() => bucketClaims(data?.claims ?? [], period), [data?.claims, period]);
  const kpis = [
    { label: `Locations · ${suffix}`, value: data?.locations ?? null, tone: "#2f6bff" },
    { label: "Profile visits", value: data?.profileVisits ?? null, tone: "#243b57" },
    { label: "Attempted claims", value: data?.attemptedClaims ?? null, tone: "#8a5cf6" },
    { label: "Successful claims", value: data?.successfulClaims ?? null, tone: "#12b76a" },
    { label: "Upgrades", value: data?.upgrades ?? null, tone: "#c07a12" },
    { label: "Revenue (ARR)", value: data?.arr ?? null, money: true, tone: "#101a2e" },
  ];

  return (
    <PageBody className="sales-spine">
      <style>{SPINE_CSS}</style>
      <PageHeader
        eyebrow="Growth Hub"
        title={scope.kind === "all" ? "Company overview" : `${scope.label} team`}
        description={scope.kind === "all" ? "Live company scope across territories, claims, logos, teams and activity." : "Live team scope across territories, claims, logos, roster and activity."}
        actions={<span className="scope-chip">{scope.kind === "all" ? "All of Experience · Company scope" : `${scope.label} · Team scope`}</span>}
      />

      {query.error ? <p className="mb-4 text-sm text-destructive">{query.error.message}</p> : null}
      <div className="kpi-grid">
        {kpis.map((kpi, index) => (
          <KpiCard key={kpi.label} label={kpi.label} value={query.isLoading ? "…" : format(kpi.value, kpi.money ? "money" : "number")} tone={kpi.tone} points={sparkPoints(chart, index)} />
        ))}
      </div>

      <section className="burn-banner">
        <div>
          <p>Territory burn-down · {suffix}</p>
          <strong>{query.isLoading ? "…" : nf.format(data?.successfulClaims ?? 0)} success</strong>
        </div>
        <div className="burn-track"><span style={{ width: `${burnPercent(data?.successfulClaims ?? 0, data?.logosRemaining)}%` }} /></div>
        <div className="text-right"><strong>{query.isLoading ? "…" : format(data?.logosRemaining ?? null)}</strong><p>logos remaining · {query.isLoading ? "…" : nf.format(data?.wonToSuccess ?? 0)} won → Success</p></div>
      </section>

      <nav className="focusnav" aria-label="Focus area">
        <span className="fl2">Focus</span>
        {FOCUSES.map((f) => {
          const Icon = f.icon;
          return <button key={f.key} className={`focuslink${focus === f.key ? " on" : ""}`} onClick={() => setFocus(f.key)} aria-pressed={focus === f.key}><Icon />{f.label}</button>;
        })}
      </nav>

      {focus === "claims" ? <ClaimsFocus data={data} loading={query.isLoading} chart={chart} period={period} setPeriod={setPeriod} series={series} setSeries={setSeries} suffix={suffix} /> : null}
      {focus === "revenue" ? <RevenueFocus data={data} loading={query.isLoading} /> : null}
      {focus === "pipeline" ? <PipelineFocus data={data} loading={query.isLoading} /> : null}
      {focus === "leaders" ? <LeadersFocus data={data} loading={query.isLoading} scope={scope} /> : null}
      {focus === "staffing" ? <StaffingFocus data={data} loading={query.isLoading} /> : null}

      {scope.kind === "team" ? (
        <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_1fr_1.35fr]">
          <Panel className="spine-panel" title="Top logos"><LogoList rows={(data?.logos ?? []).slice(0, 8)} /></Panel>
          <Panel className="spine-panel" title="Activity signal"><div className="activity-signal"><Activity /><strong>{format(data?.activitySignals ?? null)}</strong><span>signals in the last 30 days</span></div></Panel>
          <Panel className="spine-panel" title="Team roster" bodyClassName="p-0"><RosterTable reps={data?.reps ?? []} teams={data?.teamRows ?? []} /></Panel>
        </div>
      ) : null}

      <Panel className="spine-panel mt-5" title={`Activity · ${suffix}`} description="Most recent live activity events in the last 30 days." bodyClassName="p-0">
        <ActivityFeed loading={activityQuery.isLoading} rows={scopeActivity(activityQuery.data ?? [], scope.kind === "team" ? (data?.reps ?? []).map((r) => r.name) : null).slice(0, 15)} />
      </Panel>
    </PageBody>
  );
}

/* ---------- Claims focus ---------- */
function ClaimsFocus({ data, loading, chart, period, setPeriod, series, setSeries, suffix }: { data: ScopeDashboardData | undefined; loading: boolean; chart: Bucket[]; period: Period; setPeriod: (p: Period) => void; series: Series; setSeries: (s: Series) => void; suffix: string }) {
  const rows = data?.teamsLive ?? [];
  const maxSucc = Math.max(1, ...rows.map((r) => r.successful));
  return (
    <>
      <Panel className="spine-panel" title="Traffic → Attempted → Claimed" description="Traffic stays flat until a live traffic loader exists; claim lines use live claim events." actions={<PeriodToggle value={period} onChange={setPeriod} />}>
        <div className="series-chips">
          <span className="cl">Show</span>
          <SeriesChip on={series.traffic} dot="#2f6bff" label="Website Traffic" onClick={() => setSeries({ ...series, traffic: !series.traffic })} />
          <SeriesChip on={series.claimed} dot="#12b76a" label="Successful Claims" onClick={() => setSeries({ ...series, claimed: !series.claimed })} />
          <SeriesChip on={series.attempted} dot="#8a5cf6" label="Attempted Claims" onClick={() => setSeries({ ...series, attempted: !series.attempted })} />
        </div>
        <FunnelChart points={chart} series={series} />
      </Panel>

      <Panel className="spine-panel mt-4" title="Claims by category" description="Live claim events rolled up by team · sorted by successful claims." bodyClassName="p-0">
        <table>
          <thead><tr><th>Category</th><th className="num">Attempted</th><th className="num">Successful</th><th>Volume</th><th className="num">Upgrades</th><th className="num">Claim rate</th><th>Drill</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={7} className="empty">Loading…</td></tr> : rows.length ? rows.map((row) => (
              <tr key={row.groupKey}>
                <td><Link to="/sales/teams/$groupKey" params={{ groupKey: row.groupKey }}>{row.label}</Link></td>
                <td className="num">{nf.format(row.attempted)}</td>
                <td className="num" style={{ fontWeight: 700, color: "var(--sp-ink)" }}>{nf.format(row.successful)}</td>
                <td><div className="track"><i style={{ width: `${Math.round((row.successful / maxSucc) * 100)}%`, background: "var(--sp-green)" }} /></div></td>
                <td className="num">{nf.format(row.upgrades)}</td>
                <td className="num">{pct(row.successful, row.attempted)}</td>
                <td><Link to="/sales/teams/$groupKey" params={{ groupKey: row.groupKey }} className="drill">Drill ›</Link></td>
              </tr>
            )) : <tr><td colSpan={7} className="empty">No rows yet</td></tr>}
          </tbody>
        </table>
      </Panel>

      <Panel className="spine-panel mt-4" title={`Website traffic — where it comes from & how · ${suffix}`} description="Search Console + Analytics">
        <div className="await"><Activity /><div><strong>Traffic analytics not connected yet</strong><span>Density, devices, countries, top queries and top pages light up once the Search Console + Analytics loader is wired. No placeholder numbers are shown.</span></div></div>
      </Panel>
    </>
  );
}

/* ---------- Revenue focus ---------- */
function RevenueFocus({ data, loading }: { data: ScopeDashboardData | undefined; loading: boolean }) {
  const rows = (data?.teamsLive ?? []).filter((r) => r.revenue > 0 || r.successful > 0).sort((a, b) => b.revenue - a.revenue);
  return (
    <>
      <Panel className="spine-panel" title="Revenue & expansion" description="Active ARR is live from the commercial ledger. The New → Expansion → Contraction → Churn bridge lights up once the ledger loader is wired.">
        <div className="rev-head">
          <div><p>Active ARR</p><strong>{loading ? "…" : format(data?.arr ?? null, "money")}</strong></div>
          <div className="await inline"><TrendingDown /><span>Expansion / contraction / churn bridge awaits the ledger loader — not shown as placeholder numbers.</span></div>
        </div>
      </Panel>
      <Panel className="spine-panel mt-4" title="Revenue by team" description="Annualized active-contract revenue per team · live." bodyClassName="p-0">
        <table>
          <thead><tr><th>Team</th><th className="num">Revenue (ARR)</th><th className="num">Successful</th><th className="num">Upgrades</th><th>Drill</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={5} className="empty">Loading…</td></tr> : rows.length ? rows.map((row) => (
              <tr key={row.groupKey}>
                <td><Link to="/sales/teams/$groupKey" params={{ groupKey: row.groupKey }}>{row.label}</Link></td>
                <td className="num" style={{ fontWeight: 700, color: "var(--sp-ink)" }}>{format(row.revenue, "money")}</td>
                <td className="num">{nf.format(row.successful)}</td>
                <td className="num">{nf.format(row.upgrades)}</td>
                <td><Link to="/sales/teams/$groupKey" params={{ groupKey: row.groupKey }} className="drill">Drill ›</Link></td>
              </tr>
            )) : <tr><td colSpan={5} className="empty">No revenue rows yet</td></tr>}
          </tbody>
        </table>
      </Panel>
    </>
  );
}

/* ---------- Pipeline focus ---------- */
function PipelineFocus({ data, loading }: { data: ScopeDashboardData | undefined; loading: boolean }) {
  const stages = data?.pipelineStages ?? [];
  const maxVal = Math.max(1, ...stages.map((s) => s.value));
  const stageColors = ["#9dc0ff", "#6f9dff", "#7b5bff", "#e39a1e", "#e08ad0", "#39d0c0", "#16a5b8"];
  return (
    <>
      <Panel className="spine-panel" title="Nora & SRE engine" description="Nora works every claimed user; SREs take the 31+ day subset; both source enterprise pipeline.">
        <div className="nsect">
          <div className="nstat"><span className="who" style={{ background: "#8a5cf6" }}>NORA</span><div className="k">Failed to claim</div><div className="v">{loading ? "…" : nf.format(data?.attemptedClaims ?? 0)}</div><div className="sub">assisting to complete</div></div>
          <div className="nstat"><span className="who" style={{ background: "#8a5cf6" }}>NORA</span><div className="k">Successfully claimed</div><div className="v">{loading ? "…" : nf.format(data?.successfulClaims ?? 0)}</div><div className="sub">handed to adoption</div></div>
          <div className="nstat"><span className="who" style={{ background: "#8a5cf6" }}>NORA</span><div className="k">Upgrades</div><div className="v">{loading ? "…" : nf.format(data?.upgrades ?? 0)}</div><div className="sub">converted to paid</div></div>
          <div className="nstat"><span className="who" style={{ background: "#16a5b8" }}>SRE</span><div className="k">Open pipeline</div><div className="v">{loading ? "…" : format(data?.pipelineTotal ?? null, "money")}</div><div className="sub">{nf.format(stages.reduce((s, x) => s + x.count, 0))} open opportunities</div></div>
        </div>
      </Panel>
      <Panel className="spine-panel mt-4" title="Enterprise selling stages" description="Live from the opportunity pipeline, scoped.">
        {loading ? <p className="empty">Loading…</p> : stages.length ? (
          <div className="stagewrap">
            {stages.map((s, i) => (
              <div className="hbar" key={s.stage}>
                <span className="nm">{s.stage}</span>
                <div className="track"><i style={{ width: `${Math.round((s.value / maxVal) * 100)}%`, background: stageColors[i % stageColors.length] }} /></div>
                <span className="val">{cf.format(s.value)}</span>
                <span className="cnt">{nf.format(s.count)}</span>
              </div>
            ))}
          </div>
        ) : <div className="await"><TrendingDown /><div><strong>No open enterprise opportunities in scope</strong><span>Create an opportunity from a logo and advance stages to see the funnel fill in.</span></div></div>}
      </Panel>
    </>
  );
}

/* ---------- Leaderboards focus ---------- */
function LeadersFocus({ data, loading, scope }: { data: ScopeDashboardData | undefined; loading: boolean; scope: SalesScope }) {
  const rows = (data?.teamsLive ?? []).slice().sort((a, b) => b.successful - a.successful);
  const max = Math.max(1, ...rows.map((r) => r.successful));
  return (
    <>
      <Panel className="spine-panel" title={scope.kind === "all" ? "Teams ranked by successful claims" : "This team"} description="Live claim performance · bars relative to the leader.">
        {loading ? <p className="empty">Loading…</p> : rows.length ? (
          <div className="stagewrap">
            {rows.map((row, i) => (
              <div className="hbar" key={row.groupKey}>
                <span className="nm"><span className={`rank${i === 0 ? " g1" : ""}`}>{i + 1}</span> {row.label}</span>
                <div className="track"><i style={{ width: `${Math.round((row.successful / max) * 100)}%`, background: i === 0 ? "var(--sp-green)" : "#6f9dff" }} /></div>
                <span className="val">{nf.format(row.successful)}</span>
              </div>
            ))}
          </div>
        ) : <p className="empty">No teams yet</p>}
      </Panel>
      <Panel className="spine-panel mt-4" title="Team leaderboard" bodyClassName="p-0">
        <table>
          <thead><tr><th>#</th><th>Team</th><th className="num">Successful</th><th className="num">Revenue</th><th className="num">Upgrades</th><th>Drill</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={6} className="empty">Loading…</td></tr> : rows.length ? rows.map((row, i) => (
              <tr key={row.groupKey}>
                <td><span className={`rank${i === 0 ? " g1" : ""}`}>{i + 1}</span></td>
                <td><Link to="/sales/teams/$groupKey" params={{ groupKey: row.groupKey }}>{row.label}</Link></td>
                <td className="num" style={{ fontWeight: 700, color: "var(--sp-green)" }}>{nf.format(row.successful)}</td>
                <td className="num">{format(row.revenue, "money")}</td>
                <td className="num">{nf.format(row.upgrades)}</td>
                <td><Link to="/sales/teams/$groupKey" params={{ groupKey: row.groupKey }} className="drill">Drill ›</Link></td>
              </tr>
            )) : <tr><td colSpan={6} className="empty">No rows yet</td></tr>}
          </tbody>
        </table>
      </Panel>
    </>
  );
}

/* ---------- Staffing focus ---------- */
function StaffingFocus({ data, loading }: { data: ScopeDashboardData | undefined; loading: boolean }) {
  const rows = (data?.teamsLive ?? []).map((r) => ({ ...r, backlog: Math.max(0, r.attempted - r.successful) })).sort((a, b) => b.backlog - a.backlog);
  const max = Math.max(1, ...rows.map((r) => r.backlog));
  const rec = (backlog: number, sres: number) => sres === 0 ? { cls: "hire", text: "Staff now — 0 SRE coverage" } : backlog / sres > 4000 ? { cls: "hire", text: `Hire — ${nf.format(Math.round(backlog / sres))} backlog / SRE` } : backlog / sres > 1500 ? { cls: "watch", text: "Monitor" } : { cls: "ok", text: "Adequate" };
  return (
    <>
      <Panel className="spine-panel" title="Unclaimed backlog by category" description="Attempted-but-not-claimed demand · red = under-covered. Where to add heads.">
        {loading ? <p className="empty">Loading…</p> : rows.length ? (
          <div className="stagewrap">
            {rows.map((row) => (
              <div className="hbar" key={row.groupKey}>
                <span className="nm">{row.label}</span>
                <div className="track"><i style={{ width: `${Math.round((row.backlog / max) * 100)}%`, background: row.sres === 0 ? "var(--sp-red)" : row.backlog / Math.max(1, row.sres) > 4000 ? "var(--sp-red)" : row.backlog / Math.max(1, row.sres) > 1500 ? "var(--sp-amber)" : "var(--sp-green)" }} /></div>
                <span className="val">{nf.format(row.backlog)}</span>
              </div>
            ))}
          </div>
        ) : <p className="empty">No backlog rows yet</p>}
      </Panel>
      <Panel className="spine-panel mt-4" title="Recommended hires" description="Backlog ÷ coverage per team · live heuristic." bodyClassName="p-0">
        <table>
          <thead><tr><th>Team</th><th className="num">Backlog</th><th className="num">SREs</th><th className="num">Backlog / SRE</th><th>Recommendation</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={5} className="empty">Loading…</td></tr> : rows.length ? rows.map((row) => {
              const r = rec(row.backlog, row.sres);
              return (
                <tr key={row.groupKey}>
                  <td><Link to="/sales/teams/$groupKey" params={{ groupKey: row.groupKey }}>{row.label}</Link></td>
                  <td className="num" style={{ fontWeight: 700 }}>{nf.format(row.backlog)}</td>
                  <td className="num">{nf.format(row.sres)}</td>
                  <td className="num">{row.sres ? nf.format(Math.round(row.backlog / row.sres)) : "—"}</td>
                  <td><span className={`rec ${r.cls}`}>{r.text}</span></td>
                </tr>
              );
            }) : <tr><td colSpan={5} className="empty">No rows yet</td></tr>}
          </tbody>
        </table>
      </Panel>
    </>
  );
}

/* ---------- shared bits ---------- */
const dtf = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });
const scopeActivity = (rows: ActivityEvent[], names: string[] | null) => names ? rows.filter((row) => row.actor != null && names.includes(row.actor)) : rows;
function ActivityFeed({ rows, loading }: { rows: ActivityEvent[]; loading: boolean }) {
  return <table><thead><tr><th>When</th><th>Event</th><th>Logo</th><th>Location</th><th>Actor</th></tr></thead><tbody>{loading ? <tr><td colSpan={5} className="empty">Loading…</td></tr> : rows.length ? rows.map((row) => <tr key={row.id}><td>{row.occurred_at ? dtf.format(new Date(row.occurred_at)) : "—"}</td><td><span className="status-pill">{row.event_type.replace(/_/g, " ")}</span></td><td>{row.logo ?? "—"}</td><td>{row.location ?? "—"}</td><td>{row.actor ?? "—"}</td></tr>) : <tr><td colSpan={5} className="empty">No rows yet</td></tr>}</tbody></table>;
}

function SeriesChip({ on, dot, label, onClick }: { on: boolean; dot: string; label: string; onClick: () => void }) {
  return <button className={`series-chip${on ? "" : " off"}`} onClick={onClick}><span className="dot" style={{ background: on ? dot : "#c3ccd8" }} />{label}<span className="x">{on ? "✕" : "+"}</span></button>;
}

function KpiCard({ label, value, tone, points }: { label: string; value: string; tone: string; points: number[] }) {
  const line = points.map((v, i) => `${i * (100 / Math.max(1, points.length - 1))},${24 - v}`).join(" ");
  const area = `0,24 ${line} 100,24`;
  return <article className="kpi-card" style={{ "--tone": tone } as React.CSSProperties}><p>{label}</p><div className="kpi-value">{value}</div><div className="kpi-foot"><span className="delta"><ArrowUp />—</span><svg viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true"><polygon className="spark-area" points={area} /><polyline points={line} /></svg></div></article>;
}

function PeriodToggle({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return <div className="period-toggle">{(["daily", "weekly", "monthly"] as Period[]).map((p) => <Button key={p} size="sm" variant={value === p ? "default" : "ghost"} onClick={() => onChange(p)}>{p[0].toUpperCase() + p.slice(1)}</Button>)}</div>;
}

type Bucket = { label: string; traffic: number | null; attempted: number; claimed: number };
function FunnelChart({ points, series }: { points: Bucket[]; series: Series }) {
  const width = 780, height = 220, left = 35, bottom = 180;
  const max = Math.max(1, ...points.flatMap((p) => [p.attempted, p.claimed]));
  const x = (i: number) => left + i * ((width - left - 20) / Math.max(1, points.length - 1));
  const y = (v: number) => bottom - (v / max) * 145;
  const line = (key: "attempted" | "claimed") => points.map((p, i) => `${x(i)},${y(p[key])}`).join(" ");
  const area = (key: "attempted" | "claimed") => `${left},${bottom} ${line(key)} ${width - 20},${bottom}`;
  return <div><svg className="funnel-chart" viewBox={`0 0 ${width} ${height}`}><defs><linearGradient id="fc-attempted" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8a5cf6" stopOpacity="0.28"/><stop offset="100%" stopColor="#8a5cf6" stopOpacity="0"/></linearGradient><linearGradient id="fc-claimed" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#12b76a" stopOpacity="0.30"/><stop offset="100%" stopColor="#12b76a" stopOpacity="0"/></linearGradient></defs><line x1={left} y1={bottom} x2={width - 20} y2={bottom} className="axis"/>{series.attempted ? <polygon points={area("attempted")} fill="url(#fc-attempted)" stroke="none"/> : null}{series.claimed ? <polygon points={area("claimed")} fill="url(#fc-claimed)" stroke="none"/> : null}{series.attempted ? <polyline points={line("attempted")} className="attempted"/> : null}{series.claimed ? <polyline points={line("claimed")} className="claimed"/> : null}{points.map((p, i) => <text key={p.label} x={x(i)} y={205} textAnchor="middle">{i % Math.max(1, Math.ceil(points.length / 7)) === 0 ? p.label : ""}</text>)}</svg><div className="legend">{series.traffic ? <span><i className="traffic"/>Traffic —</span> : null}{series.attempted ? <span><i className="attempted"/>Attempted</span> : null}{series.claimed ? <span><i className="claimed"/>Claimed</span> : null}</div></div>;
}

function LogoList({ rows }: { rows: { id: string; name: string; logoUrl: string | null; claims: number; upgrades: number }[] }) {
  return <ol className="rank-list">{rows.length ? rows.map((row) => <li key={row.id}><BrandAvatar name={row.name} logoUrl={row.logoUrl} size="xs"/><div><Link to="/sales/brands/$orgId" params={{ orgId: row.id }}>{row.name}</Link><small>{row.upgrades} upgrades</small></div><strong>{nf.format(row.claims)}</strong></li>) : <li className="empty">No rows yet</li>}</ol>;
}

function RosterTable({ reps, teams }: { reps: { id: string; name: string; role: string; photo_url: string | null }[]; teams: TeamRowLike[] }) {
  const openSeats = teams.filter((team) => !team.seller_id);
  return <table><thead><tr><th>Member</th><th>Role</th><th>Status</th></tr></thead><tbody>{reps.map((rep) => <tr key={rep.id}><td><Link to="/sales/worklist" search={{ rep: rep.id, view: /^(srx|sre)$/i.test(rep.role ?? "") ? "sre" : "seller" }} className="member"><PersonAvatar name={rep.name} photoUrl={rep.photo_url} size="xs"/>{rep.name}</Link></td><td>{/^(srx|sre)$/i.test(rep.role ?? "") ? "SRE" : rep.role}</td><td><span className="status-pill green">Active</span></td></tr>)}{reps.length === 0 ? <tr><td>NORA</td><td>Automation</td><td><span className="status-pill">—</span></td></tr> : null}{openSeats.map((seat) => <tr key={seat.id}><td>Open seat</td><td>{seat.tier}</td><td><span className="status-pill amber">Open</span></td></tr>)}</tbody></table>;
}
type TeamRowLike = { id: string; seller_id: string | null; tier: string };

function bucketClaims(claims: { occurred_at: string | null; event_type: string | null }[], period: Period): Bucket[] {
  const size = period === "daily" ? 1 : period === "weekly" ? 7 : 30;
  const buckets = period === "daily" ? 14 : period === "weekly" ? 13 : 12;
  const now = new Date();
  return Array.from({ length: buckets }, (_, index) => {
    const end = new Date(now.getTime() - (buckets - 1 - index) * size * 86_400_000);
    const start = new Date(end.getTime() - size * 86_400_000);
    const rows = claims.filter((row) => row.occurred_at && Date.parse(row.occurred_at) >= start.getTime() && Date.parse(row.occurred_at) < end.getTime());
    return { label: period === "monthly" ? end.toLocaleDateString("en-US", { month: "short" }) : `${end.getUTCMonth() + 1}/${end.getUTCDate()}`, traffic: null, attempted: rows.filter((row) => row.event_type === "attempted").length, claimed: rows.filter((row) => ["claimed", "engaged", "upgraded"].includes(row.event_type ?? "")).length };
  });
}
const sparkPoints = (points: { attempted: number; claimed: number }[], index: number) => { const values = points.slice(-8).map((p) => index % 2 ? p.claimed : p.attempted); const max = Math.max(1, ...values); return values.map((v) => Math.round((v / max) * 20)); };
const burnPercent = (won: number, remaining: number | null | undefined) => remaining == null ? 0 : Math.min(100, (won / Math.max(1, won + remaining)) * 100);

const SPINE_CSS = `
.sales-spine{--sp-ink:#101a2e;--sp-secondary:#243b57;--sp-muted:#6b7688;--sp-line:#e7ebf1;--sp-bg:#f6f8fb;--sp-blue:#2f6bff;--sp-green:#12b76a;--sp-purple:#8a5cf6;--sp-amber:#c07a12;--sp-red:#e0533d;color:var(--sp-secondary);font-variant-numeric:tabular-nums}.sales-spine .scope-chip{border:1px solid #d9e4ff;border-radius:9px;background:linear-gradient(180deg,#f3f7ff,#fff);padding:8px 13px;color:var(--sp-blue);font-size:12px;font-weight:800;box-shadow:0 1px 2px rgba(47,107,255,.08)}.sales-spine .kpi-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px}.sales-spine .spine-panel{background:#fff;border:1px solid var(--sp-line);border-radius:16px;box-shadow:0 1px 2px rgba(16,26,46,.05),0 8px 24px -16px rgba(16,26,46,.18)}.sales-spine .kpi-card{position:relative;overflow:hidden;padding:15px 15px 13px;border-radius:16px;border:1px solid color-mix(in srgb,var(--tone) 22%,var(--sp-line));background:linear-gradient(160deg,color-mix(in srgb,var(--tone) 12%,#fff) 0%,#fff 62%);box-shadow:0 1px 2px rgba(16,26,46,.05),0 10px 22px -18px color-mix(in srgb,var(--tone) 60%,transparent);transition:transform .14s ease,box-shadow .14s ease}.sales-spine .kpi-card:hover{transform:translateY(-2px);box-shadow:0 1px 2px rgba(16,26,46,.05),0 16px 28px -16px color-mix(in srgb,var(--tone) 55%,transparent)}.sales-spine .kpi-card:before{content:"";position:absolute;inset:0 auto auto 0;height:4px;width:100%;background:linear-gradient(90deg,var(--tone),color-mix(in srgb,var(--tone) 35%,#fff))}.sales-spine .kpi-card>p{color:color-mix(in srgb,var(--tone) 55%,var(--sp-muted));font-size:10.5px;font-weight:800;min-height:30px;text-transform:uppercase;letter-spacing:.03em}.sales-spine .kpi-card .spark-area{fill:var(--tone);opacity:.16}.sales-spine .kpi-value{font-size:25px;font-weight:800;color:var(--sp-ink);line-height:1}.sales-spine .kpi-foot{display:flex;align-items:end;gap:5px;margin-top:10px}.sales-spine .kpi-foot svg{width:70px;height:26px;margin-left:auto}.sales-spine .kpi-foot polyline{fill:none;stroke:var(--tone);stroke-width:2}.sales-spine .delta{display:flex;align-items:center;color:var(--sp-muted);font-size:10px}.sales-spine .delta svg{width:11px;height:11px}.sales-spine .burn-banner{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:24px;margin:16px 0;background:linear-gradient(110deg,#0c1527 0%,#17233c 45%,#1d2f52 100%);color:white;border-radius:16px;padding:16px 20px;box-shadow:0 14px 30px -18px rgba(16,26,46,.7)}.sales-spine .burn-banner p{font-size:11px;color:#c4ccda}.sales-spine .burn-banner strong{font-size:20px}.sales-spine .burn-track{height:8px;background:#35445c;border-radius:6px;overflow:hidden}.sales-spine .burn-track span{display:block;height:100%;background:linear-gradient(90deg,#0fd17a,#12b76a);box-shadow:0 0 10px rgba(18,183,106,.55)}.sales-spine .period-toggle{display:flex;background:var(--sp-bg);border-radius:8px;padding:2px}.sales-spine .period-toggle button{height:28px;border-radius:6px;font-size:11px}.sales-spine .funnel-chart{width:100%;height:230px}.sales-spine .funnel-chart .axis{stroke:var(--sp-line)}.sales-spine .funnel-chart polyline{fill:none;stroke-width:3}.sales-spine .funnel-chart .attempted{stroke:var(--sp-purple)}.sales-spine .funnel-chart .claimed{stroke:var(--sp-green)}.sales-spine .funnel-chart text{fill:var(--sp-muted);font-size:10px}.sales-spine .legend{display:flex;justify-content:center;gap:22px;font-size:11px;color:var(--sp-muted)}.sales-spine .legend i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px}.sales-spine .legend i.traffic{background:#cbd2dc}.sales-spine .legend i.attempted{background:var(--sp-purple)}.sales-spine .legend i.claimed{background:var(--sp-green)}.sales-spine .rank-list{display:grid;gap:2px}.sales-spine .rank-list li{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--sp-line)}.sales-spine .rank-list a,.sales-spine table a{color:var(--sp-blue);font-weight:700}.sales-spine .rank-list small{display:block;color:var(--sp-muted);font-size:10px}.sales-spine .rank{display:grid;place-items:center;width:24px;height:24px;border-radius:6px;background:var(--sp-bg);font-weight:800;color:#12345c;font-size:12px}.sales-spine .rank.g1{background:#fdf3d6;color:#a9741a}.sales-spine .empty{display:block!important;color:var(--sp-muted);padding:16px}.sales-spine table{width:100%;border-collapse:collapse;font-size:12.5px}.sales-spine th{padding:9px 12px;text-align:left;text-transform:uppercase;font-size:10.5px;color:var(--sp-muted);background:#fafbfd;border-bottom:1px solid var(--sp-line)}.sales-spine td{padding:11px 12px;border-bottom:1px solid var(--sp-line)}.sales-spine tbody tr{transition:background .12s}.sales-spine tbody tr:hover{background:#f7f9fe}.sales-spine .num{text-align:right}.sales-spine .track{height:16px;background:#f1f4f9;border-radius:5px;overflow:hidden;min-width:70px}.sales-spine .track i{display:block;height:100%;border-radius:5px;background-image:linear-gradient(180deg,rgba(255,255,255,.28),rgba(255,255,255,0))}.sales-spine .drill{color:var(--sp-blue);font-weight:700}.sales-spine .member{display:flex;align-items:center;gap:8px}.sales-spine .status-pill{display:inline-flex;border-radius:6px;padding:2px 7px;background:var(--sp-bg);font-size:10px;font-weight:700}.sales-spine .status-pill.green{background:#e7f7ef;color:#087a45}.sales-spine .status-pill.amber{background:#fdf1dc;color:var(--sp-amber)}.sales-spine .activity-signal{display:flex;align-items:center;gap:12px}.sales-spine .activity-signal svg{color:var(--sp-purple)}.sales-spine .activity-signal strong{font-size:28px;color:var(--sp-ink)}.sales-spine .activity-signal span{color:var(--sp-muted);font-size:12px}
.sales-spine .focusnav{display:flex;align-items:center;gap:8px;margin:16px 0;flex-wrap:wrap}.sales-spine .focusnav .fl2{font-size:11px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--sp-muted);margin-right:4px}.sales-spine .focuslink{padding:9px 15px;border-radius:10px;font-weight:800;font-size:13.5px;color:#5b6472;cursor:pointer;border:1.5px solid var(--sp-line);background:#fff;display:inline-flex;align-items:center;gap:8px;transition:all .12s}.sales-spine .focuslink svg{width:15px;height:15px;color:var(--sp-blue)}.sales-spine .focuslink.on svg{color:#fff}.sales-spine .focuslink:hover{border-color:#9db6ff;color:var(--sp-ink);background:#f3f7ff;transform:translateY(-1px)}.sales-spine .focuslink.on{background:linear-gradient(180deg,#3f78ff,#2f6bff);color:#fff;border-color:#2f6bff;box-shadow:0 6px 14px rgba(47,107,255,.28)}
.sales-spine .series-chips{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:12px}.sales-spine .series-chips .cl{color:var(--sp-muted);font-weight:600;font-size:12px}.sales-spine .series-chip{display:inline-flex;align-items:center;gap:7px;background:#fff;border:1px solid var(--sp-line);border-radius:20px;padding:5px 11px;font-weight:600;font-size:12.5px;color:var(--sp-ink);cursor:pointer}.sales-spine .series-chip .dot{width:9px;height:9px;border-radius:50%}.sales-spine .series-chip .x{color:var(--sp-muted)}.sales-spine .series-chip.off{opacity:.55}
.sales-spine .await{display:flex;align-items:flex-start;gap:12px;padding:18px;color:var(--sp-muted)}.sales-spine .await.inline{padding:0;margin-top:4px}.sales-spine .await svg{width:20px;height:20px;color:var(--sp-purple);flex:none;margin-top:2px}.sales-spine .await strong{display:block;color:var(--sp-ink);font-size:13px}.sales-spine .await span{font-size:12px}
.sales-spine .rev-head{display:flex;align-items:center;gap:28px;flex-wrap:wrap}.sales-spine .rev-head p{font-size:11px;color:var(--sp-muted);font-weight:700}.sales-spine .rev-head strong{font-size:32px;font-weight:800;background:linear-gradient(90deg,#101a2e,#2f6bff);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.sales-spine .nsect{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.sales-spine .nstat{position:relative;overflow:hidden;border:1px solid var(--sp-line);border-radius:14px;padding:13px 15px;background:linear-gradient(160deg,#faf8ff,#fff 65%);box-shadow:0 8px 20px -18px rgba(16,26,46,.5)}.sales-spine .nstat .who{display:inline-flex;font-size:9.5px;font-weight:800;color:#fff;border-radius:4px;padding:1px 6px;margin-bottom:6px}.sales-spine .nstat .k{font-size:11.5px;color:var(--sp-muted);font-weight:700}.sales-spine .nstat .v{font-size:21px;font-weight:800;color:var(--sp-ink)}.sales-spine .nstat .sub{font-size:10.5px;color:#9aa4b2;margin-top:1px}
.sales-spine .stagewrap{display:grid;gap:9px}.sales-spine .hbar{display:grid;grid-template-columns:170px 1fr 90px 54px;gap:14px;align-items:center;font-size:13px}.sales-spine .hbar .nm{font-weight:700;color:var(--sp-secondary);display:flex;align-items:center;gap:8px}.sales-spine .hbar .track{height:24px}.sales-spine .hbar .val{text-align:right;font-weight:800;color:var(--sp-ink)}.sales-spine .hbar .cnt{text-align:right;color:var(--sp-muted);font-weight:600}
.sales-spine .rec{display:inline-flex;font-size:11.5px;font-weight:700;border-radius:7px;padding:3px 10px;white-space:nowrap}.sales-spine .rec.hire{background:#fdeae6;color:var(--sp-red)}.sales-spine .rec.watch{background:#fdf1dc;color:#a9741a}.sales-spine .rec.ok{background:#e7f7ef;color:#087a45}
@media(max-width:1100px){.sales-spine .kpi-grid{grid-template-columns:repeat(3,1fr)}.sales-spine .nsect{grid-template-columns:repeat(2,1fr)}.sales-spine .hbar{grid-template-columns:120px 1fr 80px 46px}}@media(max-width:640px){.sales-spine .kpi-grid{grid-template-columns:repeat(2,1fr)}.sales-spine .burn-banner{grid-template-columns:1fr}.sales-spine .burn-banner .text-right{text-align:left}.sales-spine .kpi-card>p{min-height:0}}
`;
