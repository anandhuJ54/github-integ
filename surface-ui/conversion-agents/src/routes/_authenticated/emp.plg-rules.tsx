import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Plus,
  Pencil,
  Copy,
  Trash2,
  FlaskConical,
  Zap,
  ToggleRight,
  Layers,
} from "lucide-react";
import { api } from "@v3/ui/lib/server-fn";
import { EmpLayout } from "@v3/ui/components/emp-layout";
import { Card } from "@v3/ui/components/ui/card";
import { Badge } from "@v3/ui/components/ui/badge";
import { Button } from "@v3/ui/components/ui/button";
import { Input } from "@v3/ui/components/ui/input";
import { Textarea } from "@v3/ui/components/ui/textarea";
import { Switch } from "@v3/ui/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@v3/ui/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@v3/ui/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/emp/plg-rules")({
  ssr: false,
  component: PlgRulesPage,
});

type Rule = {
  id: string;
  gcid: string | null;
  rule_name: string;
  rule_type: string;
  trigger_condition: Record<string, unknown> | null;
  priority: number | null;
  headline: string | null;
  body: string | null;
  cta_text: string | null;
  cta_action: string | null;
  cta_url: string | null;
  requires_upgrade: boolean | null;
  upgrade_tier: string | null;
  icon: string | null;
  is_active: boolean | null;
  created_at: string;
};

type EventStat = {
  rule_id: string;
  fires: number;
  dismissals: number;
  conversions: number;
};

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

const TYPE_COLORS: Record<string, string> = {
  banner: "bg-blue-100 text-blue-700",
  modal: "bg-violet-100 text-violet-700",
  email: "bg-emerald-100 text-emerald-700",
  score_card: "bg-amber-100 text-amber-700",
  tooltip: "bg-slate-100 text-slate-700",
  toast: "bg-rose-100 text-rose-700",
};

function PlgRulesPage() {
  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState<Rule[]>([]);
  const [stats, setStats] = useState<Map<string, EventStat>>(new Map());

  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [gcidFilter, setGcidFilter] = useState<string>("all");
  const [activeFilter, setActiveFilter] = useState<string>("all");

  const [editor, setEditor] = useState<{ open: boolean; rule: Partial<Rule> | null }>({
    open: false,
    rule: null,
  });
  const [tester, setTester] = useState<{ open: boolean; rule: Rule | null }>({
    open: false,
    rule: null,
  });

  const load = async () => {
    try {
      const res = await api.get<{ rules: Rule[]; stats: EventStat[] }>("/conversion-agents/plg-rules");
      setRules(res.rules);
      setStats(new Map(res.stats.map((st) => [st.rule_id, st])));
    } catch (e) {
      toast.error("Failed to load rules", { description: errorMessage(e) });
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const typeBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rules) {
      counts[r.rule_type] = (counts[r.rule_type] ?? 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [rules]);

  const allTypes = useMemo(
    () => Array.from(new Set(rules.map((r) => r.rule_type))).sort(),
    [rules],
  );
  const allGcids = useMemo(() => {
    const set = new Set<string>();
    for (const r of rules) if (r.gcid) set.add(r.gcid);
    return Array.from(set).sort();
  }, [rules]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return rules.filter((r) => {
      if (ql && !`${r.rule_name} ${r.headline ?? ""}`.toLowerCase().includes(ql)) return false;
      if (typeFilter !== "all" && r.rule_type !== typeFilter) return false;
      if (gcidFilter === "global" && r.gcid) return false;
      if (gcidFilter !== "all" && gcidFilter !== "global" && r.gcid !== gcidFilter) return false;
      if (activeFilter === "active" && !r.is_active) return false;
      if (activeFilter === "inactive" && r.is_active) return false;
      return true;
    });
  }, [rules, q, typeFilter, gcidFilter, activeFilter]);

  const totalActive = rules.filter((r) => r.is_active).length;

  const toggleActive = async (r: Rule, value: boolean) => {
    try {
      await api.patch(`/conversion-agents/plg-rules/${r.id}/active`, { is_active: value });
    } catch (e) {
      return toast.error("Failed to update", { description: errorMessage(e) });
    }
    setRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, is_active: value } : x)));
  };

  const duplicate = async (r: Rule) => {
    try {
      await api.post(`/conversion-agents/plg-rules/${r.id}/duplicate`);
    } catch (e) {
      return toast.error("Duplicate failed", { description: errorMessage(e) });
    }
    toast.success("Rule duplicated");
    load();
  };

  const remove = async (r: Rule) => {
    if (!confirm(`Delete rule "${r.rule_name}"?`)) return;
    try {
      await api.delete(`/conversion-agents/plg-rules/${r.id}`);
    } catch (e) {
      return toast.error("Delete failed", { description: errorMessage(e) });
    }
    toast.success("Rule deleted");
    load();
  };

  return (
    <EmpLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">PLG Rules</h1>
            <p className="text-sm text-slate-500 mt-1">
              Manage product-led growth triggers across the platform.
            </p>
          </div>
          <Button onClick={() => setEditor({ open: true, rule: { is_active: true, priority: 50 } })}>
            <Plus className="h-4 w-4 mr-1.5" /> Add Rule
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Stat label="Total Rules" value={rules.length} icon={Layers} />
          <Stat label="Active" value={totalActive} icon={ToggleRight} tone="emerald" />
          <Card className="p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
              <Zap className="h-3 w-3" /> By Type
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {typeBreakdown.length === 0 ? (
                <span className="text-xs text-slate-400">No rules</span>
              ) : (
                typeBreakdown.map(([t, c]) => (
                  <Badge key={t} variant="secondary" className={`${TYPE_COLORS[t] ?? "bg-slate-100 text-slate-700"} border-0`}>
                    {t} · {c}
                  </Badge>
                ))
              )}
            </div>
          </Card>
        </div>

        {/* Filters */}
        <Card className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search rules"
              className="pl-9"
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {allTypes.map((t) => (
                <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={gcidFilter} onValueChange={setGcidFilter}>
            <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem value="global">Global only</SelectItem>
              {allGcids.map((g) => (
                <SelectItem key={g} value={g}>{g}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={activeFilter} onValueChange={setActiveFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </Card>

        {/* Table */}
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500 border-b">
              <tr>
                <th className="text-left py-3 px-4 font-medium">Rule</th>
                <th className="text-left py-3 px-4 font-medium">Type</th>
                <th className="text-left py-3 px-4 font-medium">Category</th>
                <th className="text-left py-3 px-4 font-medium">Trigger</th>
                <th className="text-center py-3 px-4 font-medium">Priority</th>
                <th className="text-center py-3 px-4 font-medium">Upgrade</th>
                <th className="text-left py-3 px-4 font-medium">Performance</th>
                <th className="text-center py-3 px-4 font-medium">Active</th>
                <th className="text-right py-3 px-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr>
                  <td colSpan={9} className="text-center text-slate-500 py-10">Loading…</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center text-slate-500 py-10">
                    No rules match these filters.
                  </td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const s = stats.get(r.id);
                  const fires = s?.fires ?? 0;
                  const conv = s?.conversions ?? 0;
                  const rate = fires > 0 ? (conv / fires) * 100 : 0;
                  return (
                    <tr key={r.id} className="hover:bg-slate-50 align-top">
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">{r.rule_name}</div>
                        {r.headline ? (
                          <div className="text-xs text-slate-500 truncate max-w-xs">{r.headline}</div>
                        ) : null}
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant="secondary" className={`${TYPE_COLORS[r.rule_type] ?? "bg-slate-100 text-slate-700"} border-0 capitalize`}>
                          {r.rule_type}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600">
                        {r.gcid ? (
                          <code className="px-1.5 py-0.5 bg-slate-100 rounded">{r.gcid}</code>
                        ) : (
                          <Badge variant="secondary" className="bg-slate-100 text-slate-600 border-0">
                            Global
                          </Badge>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <pre className="text-[10px] leading-tight bg-slate-50 border rounded p-1.5 max-w-[200px] overflow-hidden text-slate-700">
                          {JSON.stringify(r.trigger_condition ?? {}, null, 0)}
                        </pre>
                      </td>
                      <td className="py-3 px-4 text-center tabular-nums">{r.priority ?? "—"}</td>
                      <td className="py-3 px-4 text-center">
                        {r.requires_upgrade ? (
                          <Badge variant="secondary" className="bg-amber-100 text-amber-700 border-0 capitalize">
                            {r.upgrade_tier ?? "Yes"}
                          </Badge>
                        ) : (
                          <span className="text-xs text-slate-400">No</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600 whitespace-nowrap">
                        <div className="flex flex-col gap-0.5">
                          <span>
                            <span className="text-slate-400">Fires</span> {fires.toLocaleString()}
                          </span>
                          <span>
                            <span className="text-slate-400">Conv</span> {conv.toLocaleString()} · {rate.toFixed(1)}%
                          </span>
                          <span className="text-slate-400">
                            Dismiss {s?.dismissals.toLocaleString() ?? 0}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <Switch
                          checked={!!r.is_active}
                          onCheckedChange={(v) => toggleActive(r, v)}
                        />
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Test"
                            onClick={() => setTester({ open: true, rule: r })}
                          >
                            <FlaskConical className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Edit"
                            onClick={() => setEditor({ open: true, rule: r })}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Duplicate"
                            onClick={() => duplicate(r)}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Delete"
                            className="text-rose-600 hover:text-rose-700"
                            onClick={() => remove(r)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </Card>
      </div>

      <RuleEditor
        state={editor}
        onClose={() => setEditor({ open: false, rule: null })}
        onSaved={load}
      />
      <RuleTester
        state={tester}
        onClose={() => setTester({ open: false, rule: null })}
      />
    </EmpLayout>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof Layers;
  tone?: "emerald";
}) {
  const colour = tone === "emerald" ? "text-emerald-600" : "text-slate-900";
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${colour}`}>{value.toLocaleString()}</div>
    </Card>
  );
}

/* --- Editor --- */

function RuleEditor({
  state,
  onClose,
  onSaved,
}: {
  state: { open: boolean; rule: Partial<Rule> | null };
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!state.rule?.id;
  const [form, setForm] = useState<Partial<Rule>>({});
  const [triggerText, setTriggerText] = useState("{}");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (state.open) {
      setForm(state.rule ?? {});
      setTriggerText(JSON.stringify(state.rule?.trigger_condition ?? {}, null, 2));
    }
  }, [state]);

  const set = <K extends keyof Rule>(k: K, v: Rule[K] | null | undefined) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const save = async () => {
    if (!form.rule_name || !form.rule_type) {
      toast.error("Rule name and type are required");
      return;
    }
    let trigger: Record<string, unknown> = {};
    try {
      trigger = JSON.parse(triggerText || "{}");
    } catch {
      toast.error("Trigger condition is not valid JSON");
      return;
    }
    setSubmitting(true);
    const payload = {
      gcid: form.gcid || null,
      rule_name: form.rule_name,
      rule_type: form.rule_type,
      trigger_condition: trigger,
      priority: form.priority ?? 50,
      headline: form.headline || null,
      body: form.body || null,
      cta_text: form.cta_text || null,
      cta_action: form.cta_action || null,
      cta_url: form.cta_url || null,
      requires_upgrade: !!form.requires_upgrade,
      upgrade_tier: form.upgrade_tier || null,
      icon: form.icon || null,
      is_active: form.is_active ?? true,
    };
    try {
      if (isEdit) await api.put(`/conversion-agents/plg-rules/${form.id!}`, payload);
      else await api.post("/conversion-agents/plg-rules", payload);
    } catch (e) {
      setSubmitting(false);
      return toast.error("Save failed", { description: errorMessage(e) });
    }
    setSubmitting(false);
    toast.success(isEdit ? "Rule updated" : "Rule created");
    onClose();
    onSaved();
  };

  return (
    <Dialog open={state.open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Rule" : "New PLG Rule"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Rule name" className="col-span-2">
            <Input
              value={form.rule_name ?? ""}
              onChange={(e) => set("rule_name", e.target.value)}
            />
          </Field>
          <Field label="Type">
            <Select
              value={form.rule_type ?? ""}
              onValueChange={(v) => set("rule_type", v)}
            >
              <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
              <SelectContent>
                {["banner", "modal", "email", "score_card", "tooltip", "toast"].map((t) => (
                  <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Category (gcid, blank = global)">
            <Input
              value={form.gcid ?? ""}
              onChange={(e) => set("gcid", e.target.value)}
              placeholder="e.g. gcid:mortgage_lender"
            />
          </Field>
          <Field label="Priority">
            <Input
              type="number"
              value={form.priority ?? 50}
              onChange={(e) => set("priority", Number(e.target.value))}
            />
          </Field>
          <Field label="Icon">
            <Input
              value={form.icon ?? ""}
              onChange={(e) => set("icon", e.target.value)}
              placeholder="lucide name"
            />
          </Field>
          <Field label="Headline" className="col-span-2">
            <Input
              value={form.headline ?? ""}
              onChange={(e) => set("headline", e.target.value)}
            />
          </Field>
          <Field label="Body" className="col-span-2">
            <Textarea
              rows={3}
              value={form.body ?? ""}
              onChange={(e) => set("body", e.target.value)}
            />
          </Field>
          <Field label="CTA text">
            <Input
              value={form.cta_text ?? ""}
              onChange={(e) => set("cta_text", e.target.value)}
            />
          </Field>
          <Field label="CTA action">
            <Input
              value={form.cta_action ?? ""}
              onChange={(e) => set("cta_action", e.target.value)}
              placeholder="connect_gbp, upgrade, etc."
            />
          </Field>
          <Field label="CTA URL" className="col-span-2">
            <Input
              value={form.cta_url ?? ""}
              onChange={(e) => set("cta_url", e.target.value)}
            />
          </Field>
          <Field label="Trigger condition (JSON)" className="col-span-2">
            <Textarea
              rows={6}
              value={triggerText}
              onChange={(e) => setTriggerText(e.target.value)}
              className="font-mono text-xs"
            />
            <p className="text-xs text-slate-500 mt-1">
              Example: {"{\"score_lt\": 600, \"gbp_connected\": false}"}
            </p>
          </Field>
          <Field label="Requires upgrade">
            <div className="flex items-center gap-2 h-9">
              <Switch
                checked={!!form.requires_upgrade}
                onCheckedChange={(v) => set("requires_upgrade", v)}
              />
              <span className="text-sm text-slate-600">
                {form.requires_upgrade ? "Yes" : "No"}
              </span>
            </div>
          </Field>
          <Field label="Upgrade tier">
            <Input
              value={form.upgrade_tier ?? ""}
              onChange={(e) => set("upgrade_tier", e.target.value)}
              placeholder="pro, enterprise"
              disabled={!form.requires_upgrade}
            />
          </Field>
          <Field label="Active" className="col-span-2">
            <div className="flex items-center gap-2 h-9">
              <Switch
                checked={form.is_active ?? true}
                onCheckedChange={(v) => set("is_active", v)}
              />
              <span className="text-sm text-slate-600">
                {form.is_active ?? true ? "Active" : "Inactive"}
              </span>
            </div>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={submitting}>
            {isEdit ? "Save changes" : "Create rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="text-xs font-medium text-slate-600 block mb-1">{label}</label>
      {children}
    </div>
  );
}

/* --- Tester --- */

function evaluateRule(condition: Record<string, unknown>, stats: Record<string, number | boolean>): {
  pass: boolean;
  reasons: { check: string; passed: boolean }[];
} {
  const reasons: { check: string; passed: boolean }[] = [];
  let pass = true;
  const entries = Object.entries(condition ?? {});
  if (entries.length === 0) {
    return { pass: true, reasons: [{ check: "No conditions — always fires", passed: true }] };
  }
  for (const [key, expected] of entries) {
    // Heuristic operators: score_lt, score_gt, score_gte, score_lte, <field>_eq, <field>_is
    const m = key.match(/^(.+)_(lt|lte|gt|gte|eq|is|ne|exists)$/);
    let field = key;
    let op = "eq";
    if (m) {
      field = m[1];
      op = m[2];
    }
    const actual = stats[field];
    let ok = false;
    switch (op) {
      case "lt": ok = typeof actual === "number" && actual < Number(expected); break;
      case "lte": ok = typeof actual === "number" && actual <= Number(expected); break;
      case "gt": ok = typeof actual === "number" && actual > Number(expected); break;
      case "gte": ok = typeof actual === "number" && actual >= Number(expected); break;
      case "ne": ok = actual !== expected; break;
      case "exists": ok = (actual !== undefined && actual !== null) === Boolean(expected); break;
      case "is":
      case "eq":
      default:
        ok = actual === expected;
    }
    if (!ok) pass = false;
    reasons.push({
      check: `${field} ${op} ${JSON.stringify(expected)} (actual: ${JSON.stringify(actual ?? null)})`,
      passed: ok,
    });
  }
  return { pass, reasons };
}

function RuleTester({
  state,
  onClose,
}: {
  state: { open: boolean; rule: Rule | null };
  onClose: () => void;
}) {
  const [statsText, setStatsText] = useState<string>(
    JSON.stringify(
      {
        score: 540,
        gbp_connected: false,
        review_count: 3,
        claimed: true,
        listings_published: 12,
      },
      null,
      2,
    ),
  );
  const [result, setResult] = useState<ReturnType<typeof evaluateRule> | null>(null);

  useEffect(() => {
    if (state.open) setResult(null);
  }, [state]);

  const run = () => {
    if (!state.rule) return;
    let parsed: Record<string, number | boolean> = {};
    try {
      parsed = JSON.parse(statsText);
    } catch {
      toast.error("Stats must be valid JSON");
      return;
    }
    setResult(evaluateRule(state.rule.trigger_condition ?? {}, parsed));
  };

  return (
    <Dialog open={state.open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4" /> Test Rule
          </DialogTitle>
        </DialogHeader>
        {state.rule ? (
          <div className="space-y-3">
            <div className="text-sm">
              <div className="font-medium text-slate-900">{state.rule.rule_name}</div>
              <pre className="mt-1 text-[10px] bg-slate-50 border rounded p-2 overflow-x-auto">
                {JSON.stringify(state.rule.trigger_condition ?? {}, null, 2)}
              </pre>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">
                Hypothetical professional stats (JSON)
              </label>
              <Textarea
                rows={8}
                value={statsText}
                onChange={(e) => setStatsText(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
            <Button onClick={run} className="w-full">Run test</Button>
            {result ? (
              <div className="space-y-2">
                <div
                  className={`rounded p-3 text-sm font-medium ${
                    result.pass ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {result.pass ? "Rule WOULD fire for this professional." : "Rule would NOT fire."}
                </div>
                <div className="space-y-1">
                  {result.reasons.map((r, i) => (
                    <div
                      key={i}
                      className={`text-xs px-2 py-1.5 rounded border ${
                        r.passed
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-rose-200 bg-rose-50 text-rose-700"
                      }`}
                    >
                      {r.check}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
