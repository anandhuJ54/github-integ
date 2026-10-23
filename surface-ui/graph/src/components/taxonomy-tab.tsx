import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Sparkles, X, GripVertical } from "lucide-react";
import { supabase } from "@v3/ui/integrations/supabase/client";
import { Button } from "@v3/ui/components/ui/button";
import { ModelLock } from "@v3/ui/components/model-lock";
import { Badge } from "@v3/ui/components/ui/badge";
import { Input } from "@v3/ui/components/ui/input";
import { Label } from "@v3/ui/components/ui/label";
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
import { Switch } from "@v3/ui/components/ui/switch";
import { cn } from "@v3/ui/lib/utils";

type TaxonomyRow = {
  id: string;
  gcid: string;
  level: string;
  term: string;
  term_display: string | null;
  term_slug: string | null;
  entity_scope: string | null;
  source: string | null;
  validated: boolean | null;
  priority: number | null;
  search_intent: string | null;
  search_volume_monthly: number | null;
  wikidata_id: string | null;
};

const LEVELS: { key: string; label: string }[] = [
  { key: "profession_title", label: "Profession Titles" },
  { key: "alias", label: "Category Aliases" },
  { key: "specialization", label: "Specializations" },
  { key: "product_service", label: "Products & Services" },
  { key: "audience", label: "Audiences" },
  { key: "topic", label: "Topics" },
  { key: "content_title", label: "Content Titles" },
  { key: "industry_term", label: "Industry Terms" },
  { key: "tag", label: "Tags" },
  { key: "keyword", label: "Keywords" },
  { key: "negative_keyword", label: "Negative Keywords" },
  { key: "question", label: "Questions" },
  { key: "review_aspect", label: "Review Aspects" },
  { key: "modifier", label: "Modifiers (global)" },
];

const SOURCES = ["claude_generated", "manual", "dataforseo", "gsc"] as const;

function sourceColor(s: string | null) {
  switch (s) {
    case "claude_generated":
      return "bg-violet-100 text-violet-700 border-violet-200";
    case "manual":
      return "bg-slate-100 text-slate-700 border-slate-200";
    case "dataforseo":
      return "bg-blue-100 text-blue-700 border-blue-200";
    case "gsc":
      return "bg-emerald-100 text-emerald-700 border-emerald-200";
    default:
      return "bg-slate-100 text-slate-600 border-slate-200";
  }
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function TaxonomyTab({ gcid }: { gcid: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<TaxonomyRow | null>(null);
  const [addingLevel, setAddingLevel] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["taxonomy", gcid],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exp_taxonomy")
        .select(
          "id,gcid,level,term,term_display,term_slug,entity_scope,source,validated,priority,search_intent,search_volume_monthly,wikidata_id",
        )
        .eq("gcid", gcid)
        .order("priority", { ascending: true });
      if (error) throw error;
      return (data ?? []) as TaxonomyRow[];
    },
  });

  const grouped = useMemo(() => {
    const out: Record<string, TaxonomyRow[]> = {};
    for (const lv of LEVELS) out[lv.key] = [];
    for (const r of rows) {
      if (!out[r.level]) out[r.level] = [];
      out[r.level].push(r);
    }
    for (const k of Object.keys(out)) {
      out[k].sort(
        (a, b) => (a.priority ?? 999) - (b.priority ?? 999),
      );
    }
    return out;
  }, [rows]);

  const reorder = useMutation({
    mutationFn: async (updates: { id: string; priority: number }[]) => {
      for (const u of updates) {
        const { error } = await supabase
          .from("exp_taxonomy")
          .update({ priority: u.priority })
          .eq("id", u.id);
        if (error) throw error;
      }
      await supabase.from("audit_log").insert({
        action: "taxonomy.reorder",
        entity_type: "exp_taxonomy",
        entity_id: gcid,
        metadata: { count: updates.length } as never,
      } as never);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["taxonomy", gcid] }),
  });

  const totalByLevel = useMemo(() => {
    const m: Record<string, number> = {};
    for (const lv of LEVELS) m[lv.key] = grouped[lv.key]?.length ?? 0;
    return m;
  }, [grouped]);

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center gap-6">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">
            Total Terms
          </div>
          <div className="text-2xl font-semibold text-slate-900">
            {rows.length}
          </div>
        </div>
        <div className="h-10 w-px bg-slate-200" />
        <div className="flex flex-wrap gap-3 flex-1">
          {LEVELS.map((lv) => (
            <div key={lv.key} className="text-sm">
              <span className="text-slate-500">{lv.label}:</span>{" "}
              <span className="font-medium text-slate-900">
                {totalByLevel[lv.key]}
              </span>
            </div>
          ))}
        </div>
        <Button disabled variant="outline" className="gap-2">
          <Sparkles className="h-4 w-4" />
          Generate with AI
        </Button>
      </div>

      {isLoading && (
        <div className="text-sm text-slate-500">Loading taxonomy…</div>
      )}

      {LEVELS.map((lv) => (
        <LevelSection
          key={lv.key}
          label={lv.label}
          levelKey={lv.key}
          items={grouped[lv.key] ?? []}
          onEdit={(r) => setEditing(r)}
          onAdd={() => setAddingLevel(lv.key)}
          onReorder={(ids) => {
            const updates = ids.map((id, i) => ({ id, priority: i + 1 }));
            reorder.mutate(updates);
          }}
        />
      ))}

      {editing && (
        <EditDialog
          row={editing}
          gcid={gcid}
          onClose={() => setEditing(null)}
        />
      )}
      {addingLevel && (
        <EditDialog
          row={null}
          level={addingLevel}
          gcid={gcid}
          onClose={() => setAddingLevel(null)}
        />
      )}
    </div>
  );
}

function LevelSection({
  label,
  levelKey,
  items,
  onEdit,
  onAdd,
  onReorder,
}: {
  label: string;
  levelKey: string;
  items: TaxonomyRow[];
  onEdit: (r: TaxonomyRow) => void;
  onAdd: () => void;
  onReorder: (ids: string[]) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);

  return (
    <div className="bg-white border border-slate-200 rounded-lg">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-slate-900">{label}</h3>
          <Badge variant="secondary">{items.length}</Badge>
        </div>
        <ModelLock label="Add term locked" />
      </div>
      <div className="p-4">
        {items.length === 0 ? (
          <div className="text-sm text-slate-400">No {label.toLowerCase()} yet.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {items.map((r) => (
              <button
                key={r.id}
                type="button"
                className={cn(
                  "group inline-flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full border bg-white",
                  "border-slate-200 hover:border-slate-400 hover:bg-slate-50 transition-colors text-sm",
                )}
                title={`level=${levelKey}`}
              >
                <GripVertical className="h-3.5 w-3.5 text-slate-300 group-hover:text-slate-500 cursor-grab" />
                <span className="font-medium text-slate-900">
                  {r.term_display || r.term}
                </span>
                {r.entity_scope && r.entity_scope !== "shared" && (
                  <span
                    className={cn(
                      "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border",
                      r.entity_scope === "professional"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-blue-50 text-blue-700 border-blue-200",
                    )}
                    title={`Scope: ${r.entity_scope}`}
                  >
                    {r.entity_scope}
                  </span>
                )}
                <span className="text-xs text-slate-500">#{r.priority ?? "—"}</span>
                <span
                  className={cn(
                    "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border",
                    sourceColor(r.source),
                  )}
                >
                  {r.source ?? "—"}
                </span>
                {r.validated && (
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EditDialog({
  row,
  level,
  gcid,
  onClose,
}: {
  row: TaxonomyRow | null;
  level?: string;
  gcid: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isNew = !row;
  const [term, setTerm] = useState(row?.term ?? "");
  const [termDisplay, setTermDisplay] = useState(row?.term_display ?? "");
  const [priority, setPriority] = useState<number>(row?.priority ?? 100);
  const [searchIntent, setSearchIntent] = useState(row?.search_intent ?? "");
  const [searchVolume, setSearchVolume] = useState<string>(
    row?.search_volume_monthly?.toString() ?? "",
  );
  const [wikidataId, setWikidataId] = useState(row?.wikidata_id ?? "");
  const [source, setSource] = useState(row?.source ?? "manual");
  const [validated, setValidated] = useState<boolean>(row?.validated ?? false);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        gcid,
        level: level ?? row!.level,
        term: term.trim(),
        term_slug: slugify(term),
        term_display: termDisplay.trim() || term.trim(),
        priority,
        search_intent: searchIntent || null,
        search_volume_monthly: searchVolume ? Number(searchVolume) : null,
        wikidata_id: wikidataId || null,
        source,
        validated,
      };
      if (isNew) {
        const { error } = await supabase
          .from("exp_taxonomy")
          .insert(payload as never);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("exp_taxonomy")
          .update(payload as never)
          .eq("id", row!.id);
        if (error) throw error;
      }
      await supabase.from("audit_log").insert({
        action: isNew ? "taxonomy.create" : "taxonomy.update",
        entity_type: "exp_taxonomy",
        entity_id: row?.id ?? gcid,
        metadata: payload as never,
      } as never);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["taxonomy", gcid] });
      onClose();
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!row) return;
      const { error } = await supabase
        .from("exp_taxonomy")
        .delete()
        .eq("id", row.id);
      if (error) throw error;
      await supabase.from("audit_log").insert({
        action: "taxonomy.delete",
        entity_type: "exp_taxonomy",
        entity_id: row.id,
      } as never);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["taxonomy", gcid] });
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isNew ? "Add term" : "Edit term"} · {level ?? row?.level}
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Label>Term</Label>
            <Input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="canonical term"
            />
          </div>
          <div className="col-span-2">
            <Label>Display name</Label>
            <Input
              value={termDisplay}
              onChange={(e) => setTermDisplay(e.target.value)}
              placeholder="What users see"
            />
          </div>
          <div>
            <Label>Priority</Label>
            <Input
              type="number"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
            />
          </div>
          <div>
            <Label>Source</Label>
            <Select value={source ?? "manual"} onValueChange={setSource}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Search intent</Label>
            <Select
              value={searchIntent || "none"}
              onValueChange={(v) => setSearchIntent(v === "none" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                <SelectItem value="informational">informational</SelectItem>
                <SelectItem value="navigational">navigational</SelectItem>
                <SelectItem value="commercial">commercial</SelectItem>
                <SelectItem value="transactional">transactional</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Search volume / mo</Label>
            <Input
              type="number"
              value={searchVolume}
              onChange={(e) => setSearchVolume(e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <Label>Wikidata ID</Label>
            <Input
              value={wikidataId}
              onChange={(e) => setWikidataId(e.target.value)}
              placeholder="Q12345"
            />
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <Switch checked={validated} onCheckedChange={setValidated} />
            <Label className="!m-0">Validated</Label>
          </div>
        </div>
        <DialogFooter className="flex items-center justify-between sm:justify-between">
          {!isNew ? (
            <Button
              variant="ghost"
              className="text-red-600 hover:text-red-700 gap-1"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
            >
              <X className="h-4 w-4" /> Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() => save.mutate()}
              disabled={save.isPending || !term.trim()}
            >
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
