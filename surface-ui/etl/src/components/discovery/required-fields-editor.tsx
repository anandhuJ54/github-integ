import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, useServerFn } from "@v3/ui/lib/server-fn";
import { toast } from "sonner";
import { Button } from "@v3/ui/components/ui/button";
import { Input } from "@v3/ui/components/ui/input";
import { Checkbox } from "@v3/ui/components/ui/checkbox";
import { Badge } from "@v3/ui/components/ui/badge";
import { getStagingKeys, type StagingKey } from "@v3/etl/lib/staging-keys.functions";

/* Required fields per category (rollout plan step 0.1, owner decisions T2 / D8).
   One exp_etl_field_floors row per gcid, written only through the role-checked RPC
   exp_etl_set_field_floor. Station 8 reads these rows; a gcid without a row publishes
   nothing. Rows that use the old State Farm field names stay read-only. */

export type FieldFloor = {
  gcid: string;
  min_fields: number;
  required_keys: string[];
  min_products: number;
  min_licenses: number;
  notes: string | null;
};

// An entry is one staging key (required on its own) or 2+ keys joined by '|' (any one of them).
const ENTRY_RE = /^(person|location|firm)\.[a-z_]+(\|(person|location|firm)\.[a-z_]+)*$/;
const isLegacy = (f: FieldFloor) => f.required_keys.some((k) => !ENTRY_RE.test(k));
const shortName = (id: string) => id.split(".")[1] ?? id;
const SUBJECT_LABEL: Record<string, string> = { person: "Person", location: "Office", firm: "Firm" };
const prettyKey = (id: string) => `${SUBJECT_LABEL[id.split(".")[0]] ?? ""} ${shortName(id)}`.trim();
const prettyEntry = (e: string) => e.split("|").map(prettyKey).join(" or ");
const SUBJECTS: Array<{ id: StagingKey["subject"]; label: string }> = [
  { id: "person", label: "Person" },
  { id: "location", label: "Office / location" },
  { id: "firm", label: "Firm / brand" },
];

type Draft = {
  isNew: boolean;
  gcid: string;
  keys: Set<string>;
  groups: string[][];
  pending: Set<string> | null;
  min_fields: string;
  min_products: string;
  min_licenses: string;
  notes: string;
};

const emptyDraft = (gcid = ""): Draft => ({
  isNew: true,
  gcid,
  keys: new Set(),
  groups: [],
  pending: null,
  min_fields: "0",
  min_products: "0",
  min_licenses: "0",
  notes: "",
});

export function RequiredFieldsEditor({ floors }: { floors: FieldFloor[] }) {
  const qc = useQueryClient();
  const loadKeys = useServerFn(getStagingKeys);
  const { data: keys } = useQuery({ queryKey: ["staging-keys"], queryFn: () => loadKeys(), staleTime: Infinity });
  const { data: sourceGcids } = useQuery({
    queryKey: ["etl-source-gcids"],
    queryFn: async () => {
      const data = await api.get<{ gcid: string }[]>("/etl/console/source-gcids");
      return Array.from(new Set(data.map((r) => r.gcid))).sort();
    },
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const grouped = useMemo(() => {
    const g: Record<string, StagingKey[]> = { person: [], location: [], firm: [] };
    for (const k of keys ?? []) g[k.subject]?.push(k);
    return g;
  }, [keys]);

  const edit = (f: FieldFloor) =>
    setDraft({
      isNew: false,
      gcid: f.gcid,
      keys: new Set(f.required_keys.filter((k) => !k.includes("|"))),
      groups: f.required_keys.filter((k) => k.includes("|")).map((k) => k.split("|")),
      pending: null,
      min_fields: String(f.min_fields ?? 0),
      min_products: String(f.min_products ?? 0),
      min_licenses: String(f.min_licenses ?? 0),
      notes: f.notes ?? "",
    });

  const toggle = (id: string) =>
    setDraft((d) => {
      if (!d) return d;
      const next = new Set(d.keys);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...d, keys: next };
    });

  const togglePending = (id: string) =>
    setDraft((d) => {
      if (!d || !d.pending) return d;
      const next = new Set(d.pending);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...d, pending: next };
    });

  const addGroup = () =>
    setDraft((d) => {
      if (!d || !d.pending) return d;
      const g = Array.from(d.pending).sort();
      if (g.length < 2) {
        toast.error("Pick at least two fields for an 'any one of' group");
        return d;
      }
      const key = g.join("|");
      if (d.groups.some((x) => x.join("|") === key)) return { ...d, pending: null };
      return { ...d, groups: [...d.groups, g], pending: null };
    });

  const removeGroup = (i: number) =>
    setDraft((d) => (d ? { ...d, groups: d.groups.filter((_, j) => j !== i) } : d));

  const save = async () => {
    if (!draft) return;
    const gcid = draft.gcid.trim();
    if (!gcid) return toast.error("Choose a category first");
    if (draft.isNew && floors.some((f) => f.gcid === gcid)) return toast.error(`${gcid} already has a row; use Edit`);
    const num = (v: string) => Math.max(0, Number.parseInt(v || "0", 10) || 0);
    setSaving(true);
    // role-checked exp_etl_set_field_floor, through the API
    const error = await api
      .post("/etl/console/field-floor", {
        gcid,
        required_keys: [...Array.from(draft.keys), ...draft.groups.map((g) => [...g].sort().join("|"))],
        min_fields: num(draft.min_fields),
        min_products: num(draft.min_products),
        min_licenses: num(draft.min_licenses),
        notes: draft.notes.trim() || null,
      })
      .then(() => null, (e: Error) => e);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`Required fields saved for ${gcid}`);
    setDraft(null);
    qc.invalidateQueries({ queryKey: ["etl-field-yield"] });
  };

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">Required fields per category</h2>
          <p className="text-xs text-slate-500">
            What a profile must have before it can be published (Station 8). Set per category, not per
            website. A category without a row publishes nothing.
          </p>
        </div>
        {!draft && (
          <Button size="sm" variant="outline" onClick={() => setDraft(emptyDraft())}>
            Add category
          </Button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Category</th>
              <th className="px-4 py-2">Min fields</th>
              <th className="px-4 py-2">Min products</th>
              <th className="px-4 py-2">Min licenses</th>
              <th className="px-4 py-2">Required fields</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {floors.map((f) => (
              <tr key={f.gcid} className="border-t border-slate-100 align-top">
                <td className="px-4 py-2 font-mono text-xs">{f.gcid}</td>
                <td className="px-4 py-2">{f.min_fields}</td>
                <td className="px-4 py-2">{f.min_products}</td>
                <td className="px-4 py-2">{f.min_licenses}</td>
                <td className="px-4 py-2 text-xs text-slate-600">
                  {f.required_keys.length
                    ? isLegacy(f)
                      ? f.required_keys.join(", ")
                      : f.required_keys.map((k) => (k.includes("|") ? `one of (${prettyEntry(k)})` : prettyKey(k))).join(", ")
                    : "—"}
                </td>
                <td className="px-4 py-2 text-right">
                  {isLegacy(f) ? (
                    <Badge variant="outline" title="Uses the old State Farm field names; read-only here">
                      read-only
                    </Badge>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => edit(f)} disabled={!!draft}>
                      Edit
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {!floors.length && (
              <tr>
                <td className="px-4 py-3 text-sm text-slate-500" colSpan={6}>
                  No categories configured yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {draft && (
        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          <div className="grid gap-3 md:grid-cols-4">
            <label className="space-y-1 md:col-span-1">
              <span className="text-xs font-medium text-slate-600">Category (gcid)</span>
              <Input
                list="required-fields-gcids"
                value={draft.gcid}
                onChange={(e) => setDraft({ ...draft, gcid: e.target.value })}
                placeholder="gcid:financial_advisor"
                disabled={!draft.isNew}
              />
              <datalist id="required-fields-gcids">
                {(sourceGcids ?? []).map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </label>
            {(
              [
                ["min_fields", "Min fields"],
                ["min_products", "Min products / services"],
                ["min_licenses", "Min licences"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="space-y-1">
                <span className="text-xs font-medium text-slate-600">{label}</span>
                <Input
                  type="number"
                  min={0}
                  value={draft[k]}
                  onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                />
              </label>
            ))}
          </div>

          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Required (each one)</div>
          {!keys && <p className="text-xs text-slate-500">Loading fields…</p>}
          <div className="grid gap-4 md:grid-cols-3">
            {SUBJECTS.map((s) => (
              <div key={s.id} className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{s.label}</div>
                <div className="space-y-1.5">
                  {(grouped[s.id] ?? []).map((k) => (
                    <label key={k.id} className="flex cursor-pointer items-start gap-2 text-sm" title={k.meaning ?? undefined}>
                      <Checkbox checked={draft.keys.has(k.id)} onCheckedChange={() => toggle(k.id)} className="mt-0.5" />
                      <span>
                        <span className="font-mono text-xs">{k.id.split(".")[1]}</span>
                        {k.meaning && <span className="block text-xs text-slate-500">{k.meaning}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2 rounded-md border border-dashed border-slate-300 p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Any one of</div>
                <p className="text-xs text-slate-500">
                  A group passes when at least one of its fields has a value (e.g. phone or email).
                </p>
              </div>
              {!draft.pending && (
                <Button size="sm" variant="outline" onClick={() => setDraft({ ...draft, pending: new Set() })}>
                  Add group
                </Button>
              )}
            </div>
            {draft.groups.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {draft.groups.map((g, i) => (
                  <span key={g.join("|")} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs">
                    {prettyEntry(g.join("|"))}
                    <button type="button" className="ml-1 text-slate-500 hover:text-slate-800" onClick={() => removeGroup(i)} aria-label="Remove group">
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            {draft.pending && (
              <div className="space-y-2">
                <div className="grid max-h-56 gap-3 overflow-y-auto md:grid-cols-3">
                  {SUBJECTS.map((s) => (
                    <div key={s.id} className="space-y-1">
                      <div className="text-xs text-slate-500">{s.label}</div>
                      {(grouped[s.id] ?? []).map((k) => (
                        <label key={k.id} className="flex cursor-pointer items-center gap-2 text-xs">
                          <Checkbox checked={draft.pending!.has(k.id)} onCheckedChange={() => togglePending(k.id)} />
                          <span className="font-mono">{shortName(k.id)}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setDraft({ ...draft, pending: null })}>
                    Cancel group
                  </Button>
                  <Button size="sm" onClick={addGroup}>
                    Add {draft.pending.size} field(s) as one group
                  </Button>
                </div>
              </div>
            )}
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-600">Notes</span>
            <Input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          </label>

          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">
              {draft.keys.size} required field(s), {draft.groups.length} "any one of" group(s)
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
