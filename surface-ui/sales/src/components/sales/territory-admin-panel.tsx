import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Panel, StatTile } from "@v3/ui/components/console/primitives";
import { Button } from "@v3/ui/components/ui/button";
import { Checkbox } from "@v3/ui/components/ui/checkbox";
import { Input } from "@v3/ui/components/ui/input";
import { Switch } from "@v3/ui/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@v3/ui/components/ui/select";
import { loadProposals, loadAllTerritories, rejectProposal } from "@v3/ui/lib/territories";
import { loadReps } from "@v3/sales/lib/teams";
import {
  HYDRATION_GATE_PCT,
  LANE_ROLES,
  PROFILES_PER_TERRITORY,
  addSeat,
  approveWithNora,
  loadAdminGroups,
  loadCategorySizing,
  loadHydration,
  loadRamps,
  loadSeats,
  proposeCategorySplit,
  removeSeat,
  saveSeatRamp,
  updateSeatQuota,
  type LaneRole,
  type Seat,
} from "@v3/sales/lib/territory-admin";

const nf = new Intl.NumberFormat("en-US");

export function TerritoryAdminPanel() {
  const groups = useQuery({ queryKey: ["admin-groups"], queryFn: loadAdminGroups });
  const [groupKey, setGroupKey] = useState("");
  const group = groups.data?.find((g) => g.group_key === groupKey);

  return (
    <div className="space-y-5">
      <Panel title="Category" description="Pick one category group. Nothing is generated across categories.">
        <Select value={groupKey} onValueChange={setGroupKey}>
          <SelectTrigger className="max-w-md"><SelectValue placeholder={groups.isLoading ? "Loading…" : "Choose a category group"} /></SelectTrigger>
          <SelectContent>{(groups.data ?? []).map((g) => <SelectItem key={g.group_key} value={g.group_key}>{g.label}</SelectItem>)}</SelectContent>
        </Select>
      </Panel>
      {group ? (
        <>
          <CreateTerritories groupKey={group.group_key} label={group.label} />
          <Seats groupKey={group.group_key} />
        </>
      ) : null}
    </div>
  );
}

function CreateTerritories({ groupKey, label }: { groupKey: string; label: string }) {
  const qc = useQueryClient();
  const sizing = useQuery({ queryKey: ["admin-sizing", groupKey], queryFn: () => loadCategorySizing(groupKey) });
  const hydration = useQuery({ queryKey: ["admin-hydration", groupKey], queryFn: () => loadHydration(groupKey) });
  const proposals = useQuery({ queryKey: ["admin-proposals", groupKey], queryFn: async () => (await loadProposals("pending")).filter((p) => p.group_key === groupKey) });
  const [enabled, setEnabled] = useState(false);
  const [override, setOverride] = useState(false);
  const pct = hydration.data?.pct ?? null;
  const gateOpen = (pct != null && pct >= HYDRATION_GATE_PCT) || override;
  const s = sizing.data;
  const refresh = () => { qc.invalidateQueries({ queryKey: ["admin-proposals", groupKey] }); qc.invalidateQueries({ queryKey: ["admin-territories"] }); };

  const propose = useMutation({ mutationFn: () => proposeCategorySplit(groupKey, label), onSuccess: (n) => { toast.success(n ? `${n} proposal${n === 1 ? "" : "s"} queued for approval` : "Proposals already pending"); refresh(); }, onError: (e: Error) => toast.error(e.message) });
  const approve = useMutation({ mutationFn: approveWithNora, onSuccess: () => { toast.success("Territory created · NORA seated as default seller"); refresh(); }, onError: (e: Error) => toast.error(e.message) });
  const reject = useMutation({ mutationFn: rejectProposal, onSuccess: refresh, onError: (e: Error) => toast.error(e.message) });

  const why = pct == null ? "No staging rows for this category yet, so hydration cannot be measured." : `Hydration is ${pct.toFixed(1)}% — below the ${HYDRATION_GATE_PCT}% gate.`;

  return (
    <Panel title="Create territories" description={`Real profile counts · ceil(total ÷ ${nf.format(PROFILES_PER_TERRITORY)}) territories · whole logos packed first-fit-decreasing.`}>
      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Locations" value={s ? nf.format(s.locations) : "…"} />
        <StatTile label="Professionals" value={s ? nf.format(s.professionals) : "…"} />
        <StatTile label="Total profiles" value={s ? nf.format(s.total) : "…"} />
        <StatTile label="Territories" value={s ? (s.territoryCount ? nf.format(s.territoryCount) : "—") : "…"} />
      </div>
      {s?.hasProxy ? <p className="mt-2 text-xs text-muted-foreground">Part of this total comes from stored territory office/agent counts (no logos found).</p> : null}

      <h4 className="mt-5 text-xs font-semibold uppercase text-muted-foreground">Proposed split (not saved)</h4>
      {!s ? <p className="text-sm text-muted-foreground">Loading…</p> : !s.bins.length ? <p className="text-sm text-muted-foreground">No rows yet — no logos with profiles in this category.</p> : (
        <table className="mt-2 w-full text-[12.5px] tabular-nums">
          <thead><tr className="border-b text-left text-[10.5px] uppercase text-muted-foreground"><th className="py-2">Territory</th><th>Logos</th><th>Top logo</th><th className="text-right">Profiles</th></tr></thead>
          <tbody>{s.bins.map((b, i) => <tr key={i} className="border-b"><td className="py-2">{label} {i + 1}</td><td>{b.logos.length}</td><td>{b.logos[0]?.logo_name ?? "—"}</td><td className="text-right">{nf.format(b.total)}</td></tr>)}</tbody>
        </table>
      )}

      <div className="mt-5 rounded-lg border p-4">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm font-semibold"><Switch checked={enabled && gateOpen} disabled={!gateOpen} onCheckedChange={setEnabled} /> Create Territories</label>
          <span className="text-xs tabular-nums text-muted-foreground">Hydration: {pct == null ? "—" : `${pct.toFixed(1)}%`} ({nf.format(hydration.data?.deep ?? 0)} / {nf.format(hydration.data?.total ?? 0)} deep)</span>
          <label className="flex items-center gap-2 text-xs"><Checkbox checked={override} onCheckedChange={(v) => setOverride(v === true)} /> Admin override</label>
        </div>
        {!gateOpen ? <p className="mt-2 text-xs text-amber-700">Disabled: {why} Tick admin override to proceed anyway.</p> : null}
        <Button className="mt-3" size="sm" disabled={!enabled || !gateOpen || !s?.territoryCount || propose.isPending} onClick={() => propose.mutate()}>Propose {s?.territoryCount ?? 0} territories</Button>
      </div>

      <h4 className="mt-5 text-xs font-semibold uppercase text-muted-foreground">Pending proposals</h4>
      {!(proposals.data ?? []).length ? <p className="text-sm text-muted-foreground">No rows yet</p> : (
        <ul className="mt-2 divide-y text-[12.5px]">
          {(proposals.data ?? []).map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div><strong>{p.proposed_label}</strong> <span className="text-muted-foreground">· {p.proposed_tier} · {p.rationale}</span></div>
              <div className="flex gap-2">
                <Button size="sm" disabled={!gateOpen || approve.isPending} onClick={() => approve.mutate(p)}>Approve + seat NORA</Button>
                <Button size="sm" variant="outline" onClick={() => reject.mutate(p.id)}>Reject</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Seats({ groupKey }: { groupKey: string }) {
  const qc = useQueryClient();
  const territories = useQuery({ queryKey: ["admin-territories"], queryFn: loadAllTerritories });
  const reps = useQuery({ queryKey: ["admin-reps"], queryFn: loadReps });
  const seats = useQuery({ queryKey: ["admin-seats", groupKey], queryFn: () => loadSeats(groupKey) });
  const teamTerritories = useMemo(() => (territories.data ?? []).filter((t) => t.group_key === groupKey), [territories.data, groupKey]);
  const ramps = useQuery({ queryKey: ["admin-ramps", groupKey, teamTerritories.length], queryFn: () => loadRamps(teamTerritories.map((t) => t.id)), enabled: !!teamTerritories.length });
  const repName = (id: string) => reps.data?.find((r) => r.id === id)?.name ?? id.slice(0, 8);
  const terrLabel = (id: string) => teamTerritories.find((t) => t.id === id)?.label ?? "—";

  const [repId, setRepId] = useState("");
  const [role, setRole] = useState<LaneRole>("SMB");
  const [quota, setQuota] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["admin-seats", groupKey] }); qc.invalidateQueries({ queryKey: ["admin-ramps", groupKey] }); };
  const add = useMutation({ mutationFn: () => addSeat({ territoryIds: picked, repId, groupKey, role, quota: quota ? Number(quota) : null }), onSuccess: () => { toast.success("Seller added"); setPicked([]); refresh(); }, onError: (e: Error) => toast.error(e.message) });

  return (
    <Panel title="Sellers on this team" description="Add a 2nd+ seller alongside NORA. One seller may cover several territories; a territory may have several sellers per lane.">
      <div className="grid gap-3 lg:grid-cols-[1fr_140px_140px_auto] lg:items-end">
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Sales rep</p>
          <Select value={repId} onValueChange={setRepId}><SelectTrigger><SelectValue placeholder="Choose a rep" /></SelectTrigger>
            <SelectContent>{(reps.data ?? []).map((r) => <SelectItem key={r.id} value={r.id}>{r.name} · {r.role}</SelectItem>)}</SelectContent></Select>
        </div>
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Role</p>
          <Select value={role} onValueChange={(v) => setRole(v as LaneRole)}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{LANE_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select>
        </div>
        <div><p className="mb-1 text-xs text-muted-foreground">Monthly quota ($)</p><Input type="number" min={0} value={quota} onChange={(e) => setQuota(e.target.value)} /></div>
        <Button disabled={!repId || !picked.length || add.isPending} onClick={() => add.mutate()}>Add seller</Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        {!teamTerritories.length ? <p className="text-sm text-muted-foreground">No territories on this team yet — create them above.</p> : teamTerritories.map((t) => (
          <label key={t.id} className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
            <Checkbox checked={picked.includes(t.id)} onCheckedChange={(v) => setPicked((p) => (v === true ? [...p, t.id] : p.filter((x) => x !== t.id)))} />{t.label}
          </label>
        ))}
      </div>

      <table className="mt-5 w-full text-[12.5px] tabular-nums">
        <thead><tr className="border-b text-left text-[10.5px] uppercase text-muted-foreground"><th className="py-2">Seller</th><th>Role</th><th>Territory</th><th>Quota / mo</th><th>Ramp % by month</th><th /></tr></thead>
        <tbody>
          {!(seats.data ?? []).length ? <tr><td colSpan={6} className="py-3 text-muted-foreground">No rows yet</td></tr> : (seats.data ?? []).map((s) => (
            <SeatRow key={s.id} seat={s} name={repName(s.rep_id)} territory={terrLabel(s.territory_id)} ramp={(ramps.data ?? []).filter((r) => r.territory_id === s.territory_id && r.rep_id === s.rep_id).map((r) => r.ramp_pct)} onDone={refresh} />
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function SeatRow({ seat, name, territory, ramp, onDone }: { seat: Seat; name: string; territory: string; ramp: number[]; onDone: () => void }) {
  const [quota, setQuota] = useState(seat.monthly_quota == null ? "" : String(seat.monthly_quota));
  const [rampText, setRampText] = useState(ramp.join(", "));
  const save = useMutation({
    mutationFn: async () => {
      await updateSeatQuota(seat.id, quota ? Number(quota) : null);
      const pcts = rampText.split(",").map((x) => x.trim()).filter(Boolean).map(Number);
      if (pcts.some((n) => Number.isNaN(n))) throw new Error("Ramp must be comma-separated numbers");
      await saveSeatRamp({ territoryId: seat.territory_id, repId: seat.rep_id, pcts });
    },
    onSuccess: () => { toast.success("Saved"); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({ mutationFn: () => removeSeat(seat.id), onSuccess: onDone, onError: (e: Error) => toast.error(e.message) });
  return (
    <tr className="border-b">
      <td className="py-2">{name}{seat.is_nora_default ? <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold">Default</span> : null}</td>
      <td>{seat.lane_role}</td>
      <td>{territory}</td>
      <td><Input className="h-8 w-28" type="number" min={0} value={quota} onChange={(e) => setQuota(e.target.value)} placeholder="—" /></td>
      <td><Input className="h-8 w-44" value={rampText} onChange={(e) => setRampText(e.target.value)} placeholder="e.g. 25, 50, 75, 100" /></td>
      <td className="text-right whitespace-nowrap">
        <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => save.mutate()}>Save</Button>{" "}
        <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>Remove</Button>
      </td>
    </tr>
  );
}
