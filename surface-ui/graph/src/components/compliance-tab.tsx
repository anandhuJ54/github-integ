import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";
import { ModelLock, ModelLockNotice, ReadOnlyLock } from "@v3/ui/components/model-lock";
import { useRole } from "@v3/ui/lib/roles";
import { api } from "@v3/ui/lib/server-fn";
import { Button } from "@v3/ui/components/ui/button";
import { Input } from "@v3/ui/components/ui/input";
import { Label } from "@v3/ui/components/ui/label";
import { Switch } from "@v3/ui/components/ui/switch";
import { Textarea } from "@v3/ui/components/ui/textarea";
import { Badge } from "@v3/ui/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@v3/ui/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@v3/ui/components/ui/select";

type ComplianceRow = {
  gcid: string;
  display_license_on_profile: boolean | null;
  display_license_on_content: boolean | null;
  display_license_on_ads: boolean | null;
  display_license_on_email: boolean | null;
  license_display_format: string | null;
  license_label: string | null;
  required_disclaimers: string[] | null;
  content_restrictions: string[] | null;
  prohibited_phrases: string[] | null;
  age_gate_required: boolean | null;
  age_gate_minimum: number | null;
  hipaa_applies: boolean | null;
  glba_applies: boolean | null;
  coppa_applies: boolean | null;
  regulated_by: string[] | null;
  advertising_rules_url: string | null;
};

type RuleRow = {
  id: string;
  gcid: string;
  rule_name: string;
  rule_type: string;
  rule_value: string | null;
  applies_to: string[] | null;
  severity: string;
  is_active: boolean;
};

function PillList({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  const [input, setInput] = useState("");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {values.map((v, i) => (
          <span
            key={`${v}-${i}`}
            className="inline-flex items-center gap-1 bg-slate-100 border border-slate-200 text-slate-800 text-sm px-2 py-1 rounded-full"
          >
            {v}
            <button
              onClick={() => onChange(values.filter((_, idx) => idx !== i))}
              className="text-slate-400 hover:text-red-600"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={input}
          placeholder={placeholder}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && input.trim()) {
              e.preventDefault();
              onChange([...values, input.trim()]);
              setInput("");
            }
          }}
        />
        <Button
          variant="outline"
          onClick={() => {
            if (!input.trim()) return;
            onChange([...values, input.trim()]);
            setInput("");
          }}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

function LineList({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  return (
    <div className="space-y-2">
      {values.map((v, i) => (
        <div key={i} className="flex gap-2">
          <Textarea
            value={v}
            rows={2}
            onChange={(e) => {
              const next = [...values];
              next[i] = e.target.value;
              onChange(next);
            }}
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onChange(values.filter((_, idx) => idx !== i))}
            className="text-red-600"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() => onChange([...values, ""])}
        className="gap-1"
      >
        <Plus className="h-3.5 w-3.5" /> {placeholder}
      </Button>
    </div>
  );
}

export function ComplianceTab({ gcid }: { gcid: string }) {
  const qc = useQueryClient();
  const { canEdit } = useRole();
  const [form, setForm] = useState<ComplianceRow | null>(null);
  const [editingRule, setEditingRule] = useState<RuleRow | null>(null);
  const [adding, setAdding] = useState(false);

  const { data: comp } = useQuery({
    queryKey: ["compliance", gcid],
    queryFn: async () => {
      const data = await api.get<ComplianceRow | null>("/graph/categories/compliance", { params: { gcid } });
      return data as ComplianceRow | null;
    },
  });

  const { data: rules = [] } = useQuery({
    queryKey: ["compliance-rules", gcid],
    queryFn: async () => {
      const data = await api.get<RuleRow[]>("/graph/categories/compliance-rules", { params: { gcid } });
      return (data ?? []) as RuleRow[];
    },
  });

  useEffect(() => {
    setForm(
      comp ?? {
        gcid,
        display_license_on_profile: false,
        display_license_on_content: false,
        display_license_on_ads: false,
        display_license_on_email: false,
        license_display_format: "",
        license_label: "",
        required_disclaimers: [],
        content_restrictions: [],
        prohibited_phrases: [],
        age_gate_required: false,
        age_gate_minimum: null,
        hipaa_applies: false,
        glba_applies: false,
        coppa_applies: false,
        regulated_by: [],
        advertising_rules_url: "",
      },
    );
  }, [comp, gcid]);

  // Direct writes to exp_category_compliance are locked at the database (Ruling R21).


  const deleteRule = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/graph/categories/compliance-rules/${encodeURIComponent(id)}`);
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["compliance-rules", gcid] }),
  });

  const toggleRule = useMutation({
    mutationFn: async (r: RuleRow) => {
      await api.patch(`/graph/categories/compliance-rules/${encodeURIComponent(r.id)}/active`, {
        is_active: !r.is_active,
      });
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["compliance-rules", gcid] }),
  });

  if (!form) return <div className="text-slate-500">Loading…</div>;

  const set = <K extends keyof ComplianceRow>(k: K, v: ComplianceRow[K]) => {
    setForm({ ...form, [k]: v });
  };

  return (
    <div className="space-y-6 pb-24">
      <ModelLockNotice />
      {/* Model-owned fields (exp_category_compliance) — read-only under Ruling R21 */}
      <fieldset disabled className="space-y-6 opacity-80">
      {/* Section 1 */}
      <Section title="License Display Requirements">
        <div className="grid sm:grid-cols-2 gap-4">
          <ToggleRow
            label="Display license on profile pages"
            checked={!!form.display_license_on_profile}
            onChange={(v) => set("display_license_on_profile", v)}
          />
          <ToggleRow
            label="Display license on published content"
            checked={!!form.display_license_on_content}
            onChange={(v) => set("display_license_on_content", v)}
          />
          <ToggleRow
            label="Display license on advertisements"
            checked={!!form.display_license_on_ads}
            onChange={(v) => set("display_license_on_ads", v)}
          />
          <ToggleRow
            label="Display license on email communications"
            checked={!!form.display_license_on_email}
            onChange={(v) => set("display_license_on_email", v)}
          />
        </div>
        <div className="grid sm:grid-cols-2 gap-4 mt-4">
          <div>
            <Label>License display format</Label>
            <Input
              value={form.license_display_format ?? ""}
              placeholder="NMLS #{license_number}"
              onChange={(e) => set("license_display_format", e.target.value)}
            />
          </div>
          <div>
            <Label>License label</Label>
            <Input
              value={form.license_label ?? ""}
              placeholder="e.g. License #"
              onChange={(e) => set("license_label", e.target.value)}
            />
          </div>
        </div>
      </Section>

      {/* Section 2 */}
      <Section
        title="Required Disclaimers"
        subtitle="These appear verbatim on public pages and content"
      >
        <LineList
          values={form.required_disclaimers ?? []}
          onChange={(v) => set("required_disclaimers", v)}
          placeholder="Add disclaimer"
        />
      </Section>

      {/* Section 3 */}
      <Section
        title="Content Restrictions"
        subtitle="Instructions fed into AI content agents"
      >
        <LineList
          values={form.content_restrictions ?? []}
          onChange={(v) => set("content_restrictions", v)}
          placeholder="Add restriction"
        />
      </Section>

      {/* Section 4 */}
      <Section
        title="Prohibited Phrases"
        subtitle="AI will never output these phrases"
      >
        <PillList
          values={form.prohibited_phrases ?? []}
          onChange={(v) => set("prohibited_phrases", v)}
          placeholder="Type a phrase and press Enter"
        />
      </Section>

      {/* Section 5 */}
      <Section title="Privacy & Regulatory">
        <div className="grid sm:grid-cols-2 gap-4">
          <ToggleRow
            label="Age gate required"
            checked={!!form.age_gate_required}
            onChange={(v) => set("age_gate_required", v)}
          />
          <ToggleRow
            label="HIPAA applies"
            checked={!!form.hipaa_applies}
            onChange={(v) => set("hipaa_applies", v)}
          />
          <ToggleRow
            label="GLBA applies"
            checked={!!form.glba_applies}
            onChange={(v) => set("glba_applies", v)}
          />
          <ToggleRow
            label="COPPA applies"
            checked={!!form.coppa_applies}
            onChange={(v) => set("coppa_applies", v)}
          />
        </div>
        {form.age_gate_required && (
          <div className="mt-4 max-w-xs">
            <Label>Age gate minimum</Label>
            <Input
              type="number"
              value={form.age_gate_minimum ?? ""}
              onChange={(e) =>
                set(
                  "age_gate_minimum",
                  e.target.value ? Number(e.target.value) : null,
                )
              }
            />
          </div>
        )}
        <div className="mt-4">
          <Label>Regulated by</Label>
          <PillList
            values={form.regulated_by ?? []}
            onChange={(v) => set("regulated_by", v)}
            placeholder="Add regulator and press Enter"
          />
        </div>
        <div className="mt-4">
          <Label>Advertising rules URL</Label>
          <Input
            value={form.advertising_rules_url ?? ""}
            placeholder="https://…"
            onChange={(e) => set("advertising_rules_url", e.target.value)}
          />
        </div>
      </Section>

      </fieldset>

      {/* Section 6 */}
      <Section title="AI Content Filter Rules">
        <div className="flex justify-end mb-3">
          {canEdit ? (
            <Button size="sm" onClick={() => setAdding(true)} className="gap-1">
              <Plus className="h-4 w-4" /> Add Rule
            </Button>
          ) : (
            <ReadOnlyLock />
          )}
        </div>
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left p-3">Rule name</th>
                <th className="text-left p-3">Type</th>
                <th className="text-left p-3">Applies to</th>
                <th className="text-left p-3">Severity</th>
                <th className="text-left p-3">Active</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {rules.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-400">
                    No rules yet.
                  </td>
                </tr>
              )}
              {rules.map((r) => (
                <tr
                  key={r.id}
                  className={`border-t border-slate-100 hover:bg-slate-50 ${canEdit ? "cursor-pointer" : ""}`}
                  onClick={() => canEdit && setEditingRule(r)}
                >
                  <td className="p-3 font-medium text-slate-900">
                    {r.rule_name}
                  </td>
                  <td className="p-3">
                    <Badge variant="outline">{r.rule_type}</Badge>
                  </td>
                  <td className="p-3 text-slate-600">
                    {(r.applies_to ?? []).join(", ") || "—"}
                  </td>
                  <td className="p-3">
                    <SeverityBadge sev={r.severity} />
                  </td>
                  <td className="p-3" onClick={(e) => e.stopPropagation()}>
                    <Switch
                      checked={r.is_active}
                      disabled={!canEdit}
                      onCheckedChange={() => toggleRule.mutate(r)}
                    />
                  </td>
                  <td
                    className="p-3 text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {canEdit ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-red-600"
                        onClick={() => deleteRule.mutate(r.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Save bar — model writes are locked (Ruling R21) */}
      <div className="fixed bottom-0 right-0 left-64 bg-white border-t border-slate-200 px-6 py-3 flex items-center justify-end gap-3 z-10">
        <ModelLock label="Model locked" />
      </div>

      {(editingRule || adding) && (
        <RuleDialog
          gcid={gcid}
          rule={editingRule}
          onClose={() => {
            setEditingRule(null);
            setAdding(false);
          }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["compliance-rules", gcid] });
            setEditingRule(null);
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5">
      <div className="mb-4">
        <h3 className="font-semibold text-slate-900">{title}</h3>
        {subtitle && (
          <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between p-3 border border-slate-200 rounded-md">
      <span className="text-sm text-slate-800">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function SeverityBadge({ sev }: { sev: string }) {
  const colors: Record<string, string> = {
    critical: "bg-red-100 text-red-700 border-red-200",
    high: "bg-orange-100 text-orange-700 border-orange-200",
    medium: "bg-amber-100 text-amber-700 border-amber-200",
    low: "bg-slate-100 text-slate-700 border-slate-200",
  };
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded border ${colors[sev] ?? colors.low}`}
    >
      {sev}
    </span>
  );
}

function RuleDialog({
  gcid,
  rule,
  onClose,
  onSaved,
}: {
  gcid: string;
  rule: RuleRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !rule;
  const [name, setName] = useState(rule?.rule_name ?? "");
  const [type, setType] = useState(rule?.rule_type ?? "prohibited_phrase");
  const [value, setValue] = useState(rule?.rule_value ?? "");
  const [applies, setApplies] = useState<string[]>(rule?.applies_to ?? []);
  const [severity, setSeverity] = useState(rule?.severity ?? "medium");
  const [active, setActive] = useState<boolean>(rule?.is_active ?? true);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        gcid,
        rule_name: name.trim(),
        rule_type: type,
        rule_value: value || null,
        applies_to: applies,
        severity,
        is_active: active,
      };
      // insert / update, then the audit_log insert whose error was ignored (server side)
      if (isNew) {
        await api.post("/graph/categories/compliance-rules", payload);
      } else {
        await api.patch(`/graph/categories/compliance-rules/${encodeURIComponent(rule!.id)}`, payload);
      }
    },
    onSuccess: onSaved,
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isNew ? "Add rule" : "Edit rule"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Rule name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="prohibited_phrase">prohibited_phrase</SelectItem>
                  <SelectItem value="required_disclaimer">required_disclaimer</SelectItem>
                  <SelectItem value="pattern_block">pattern_block</SelectItem>
                  <SelectItem value="claim_restriction">claim_restriction</SelectItem>
                  <SelectItem value="format_requirement">format_requirement</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Severity</Label>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">low</SelectItem>
                  <SelectItem value="medium">medium</SelectItem>
                  <SelectItem value="high">high</SelectItem>
                  <SelectItem value="critical">critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Rule value</Label>
            <Textarea
              value={value}
              rows={3}
              onChange={(e) => setValue(e.target.value)}
              placeholder="phrase, pattern, or text"
            />
          </div>
          <div>
            <Label>Applies to</Label>
            <PillList
              values={applies}
              onChange={setApplies}
              placeholder="e.g. ai_content, profile, review_reply"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={active} onCheckedChange={setActive} />
            <Label className="!m-0">Active</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={!name.trim() || save.isPending}
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
