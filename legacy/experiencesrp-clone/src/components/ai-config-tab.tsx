import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { GripVertical, Plus, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type AiAgents = Record<string, unknown> & {
  sdr_agent?: {
    tone?: string;
    outreach_hook?: string;
    primary_cta?: string;
    prohibited?: string[];
  };
  review_response_agent?: {
    response_style?: string;
    structure?: { thank?: string; acknowledge?: string; reinforce?: string; cta?: string };
    prohibited_words?: string[];
    max_length?: number;
  };
  content_assistant?: {
    primary_topics?: string[];
    tone?: string;
    always_include?: string[];
    prohibited?: string[];
    seo_strategy?: string;
  };
  listing_optimizer?: {
    priority_directories?: string[];
    sync_frequency?: string;
    alert_triggers?: string[];
  };
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
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2 min-h-[28px]">
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

function OrderedList({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  return (
    <div className="space-y-2">
      {values.map((v, i) => (
        <div
          key={i}
          draggable
          onDragStart={() => setDragIdx(i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragIdx === null || dragIdx === i) return;
            const next = [...values];
            const [m] = next.splice(dragIdx, 1);
            next.splice(i, 0, m);
            setDragIdx(null);
            onChange(next);
          }}
          className="flex items-center gap-2 bg-white border border-slate-200 rounded-md p-2"
        >
          <GripVertical className="h-4 w-4 text-slate-400 cursor-grab" />
          <Input
            value={v}
            onChange={(e) => {
              const next = [...values];
              next[i] = e.target.value;
              onChange(next);
            }}
          />
          <Button
            variant="ghost"
            size="icon"
            className="text-red-600"
            onClick={() => onChange(values.filter((_, idx) => idx !== i))}
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
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

export function AiConfigTab({ gcid }: { gcid: string }) {
  const qc = useQueryClient();
  const [agents, setAgents] = useState<AiAgents>({});
  const [dirty, setDirty] = useState(false);

  const { data: know } = useQuery({
    queryKey: ["ai-config", gcid],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exp_category_knowledge")
        .select("ai_agents")
        .eq("gcid", gcid)
        .maybeSingle();
      if (error) throw error;
      return data as { ai_agents: AiAgents | null } | null;
    },
  });

  const { data: comp } = useQuery({
    queryKey: ["ai-config-compliance", gcid],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exp_category_compliance")
        .select("content_restrictions, prohibited_phrases, required_disclaimers")
        .eq("gcid", gcid)
        .maybeSingle();
      if (error) throw error;
      return data as {
        content_restrictions: string[] | null;
        prohibited_phrases: string[] | null;
        required_disclaimers: string[] | null;
      } | null;
    },
  });

  useEffect(() => {
    setAgents((know?.ai_agents ?? {}) as AiAgents);
    setDirty(false);
  }, [know]);

  const save = useMutation({
    mutationFn: async () => {
      const merged = { ...(know?.ai_agents ?? {}), ...agents };
      const { error } = await supabase
        .from("exp_category_knowledge")
        .update({ ai_agents: merged as never })
        .eq("gcid", gcid);
      if (error) throw error;
      await supabase.from("audit_log").insert({
        action: "ai_config.update",
        entity_type: "exp_category_knowledge",
        entity_id: gcid,
      } as never);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-config", gcid] });
      qc.invalidateQueries({ queryKey: ["knowledge", gcid] });
      setDirty(false);
    },
  });

  const update = <K extends keyof AiAgents>(k: K, v: AiAgents[K]) => {
    setAgents({ ...agents, [k]: v });
    setDirty(true);
  };

  const sdr = agents.sdr_agent ?? {};
  const rev = agents.review_response_agent ?? {};
  const con = agents.content_assistant ?? {};
  const lst = agents.listing_optimizer ?? {};

  const complianceNote = useMemo(() => {
    if (!comp) return "";
    const lines: string[] = [];
    if (comp.prohibited_phrases?.length)
      lines.push(`Never use: ${comp.prohibited_phrases.join(", ")}`);
    if (comp.content_restrictions?.length)
      lines.push(...comp.content_restrictions);
    if (comp.required_disclaimers?.length)
      lines.push(
        `Required disclaimers: ${comp.required_disclaimers.length} on file`,
      );
    return lines.join("\n");
  }, [comp]);

  return (
    <div className="space-y-6 pb-24">
      {/* SDR */}
      <Section title="1 · SDR Agent" subtitle="Outbound outreach voice">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label>Tone</Label>
            <Select
              value={sdr.tone ?? "professional"}
              onValueChange={(v) => update("sdr_agent", { ...sdr, tone: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="professional">professional</SelectItem>
                <SelectItem value="friendly">friendly</SelectItem>
                <SelectItem value="technical">technical</SelectItem>
                <SelectItem value="urgent">urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Primary CTA</Label>
            <Input
              value={sdr.primary_cta ?? ""}
              placeholder="Book a 15-min intro call"
              onChange={(e) =>
                update("sdr_agent", { ...sdr, primary_cta: e.target.value })
              }
            />
          </div>
        </div>
        <div>
          <Label>Outreach hook</Label>
          <Textarea
            rows={3}
            value={sdr.outreach_hook ?? ""}
            placeholder="The opening message angle…"
            onChange={(e) =>
              update("sdr_agent", { ...sdr, outreach_hook: e.target.value })
            }
          />
        </div>
        <div>
          <Label>Prohibited</Label>
          <PillList
            values={sdr.prohibited ?? []}
            onChange={(v) => update("sdr_agent", { ...sdr, prohibited: v })}
            placeholder="Add phrase the SDR must never say"
          />
        </div>
        <div>
          <Label>Compliance note (from Compliance tab)</Label>
          <Textarea
            rows={4}
            value={complianceNote}
            readOnly
            className="bg-slate-50 text-slate-600"
          />
        </div>
      </Section>

      {/* Review Response */}
      <Section title="2 · Review Response Agent">
        <div>
          <Label>
            Response style{" "}
            <span className="text-xs text-slate-400">
              ({(rev.response_style ?? "").length} chars)
            </span>
          </Label>
          <Textarea
            rows={3}
            value={rev.response_style ?? ""}
            onChange={(e) =>
              update("review_response_agent", {
                ...rev,
                response_style: e.target.value,
              })
            }
          />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          {(["thank", "acknowledge", "reinforce", "cta"] as const).map((k) => (
            <div key={k}>
              <Label className="capitalize">{k}</Label>
              <Input
                value={rev.structure?.[k] ?? ""}
                onChange={(e) =>
                  update("review_response_agent", {
                    ...rev,
                    structure: { ...(rev.structure ?? {}), [k]: e.target.value },
                  })
                }
              />
            </div>
          ))}
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label>Prohibited words</Label>
            <PillList
              values={rev.prohibited_words ?? []}
              onChange={(v) =>
                update("review_response_agent", {
                  ...rev,
                  prohibited_words: v,
                })
              }
              placeholder="Add word"
            />
          </div>
          <div>
            <Label>Max length (characters)</Label>
            <Input
              type="number"
              value={rev.max_length ?? ""}
              onChange={(e) =>
                update("review_response_agent", {
                  ...rev,
                  max_length: e.target.value ? Number(e.target.value) : undefined,
                })
              }
            />
          </div>
        </div>
      </Section>

      {/* Content Assistant */}
      <Section
        title="3 · Content Assistant (Voce)"
        subtitle="Powers article, social, and Q&A generation"
      >
        <div>
          <Label>Primary topics</Label>
          <OrderedList
            values={con.primary_topics ?? []}
            onChange={(v) =>
              update("content_assistant", { ...con, primary_topics: v })
            }
            placeholder="Add topic"
          />
        </div>
        <div>
          <Label>Tone</Label>
          <Textarea
            rows={2}
            value={con.tone ?? ""}
            placeholder='e.g. "expert but approachable"'
            onChange={(e) =>
              update("content_assistant", { ...con, tone: e.target.value })
            }
          />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label>Always include</Label>
            <PillList
              values={con.always_include ?? []}
              onChange={(v) =>
                update("content_assistant", { ...con, always_include: v })
              }
              placeholder="e.g. NMLS ID"
            />
          </div>
          <div>
            <Label>Prohibited</Label>
            <PillList
              values={con.prohibited ?? []}
              onChange={(v) =>
                update("content_assistant", { ...con, prohibited: v })
              }
              placeholder="Add phrase"
            />
          </div>
        </div>
        <div>
          <Label>SEO strategy</Label>
          <Textarea
            rows={3}
            value={con.seo_strategy ?? ""}
            onChange={(e) =>
              update("content_assistant", { ...con, seo_strategy: e.target.value })
            }
          />
        </div>
      </Section>

      {/* Listing Optimizer */}
      <Section title="4 · Listing Optimizer Agent">
        <div>
          <Label>Priority directories</Label>
          <OrderedList
            values={lst.priority_directories ?? []}
            onChange={(v) =>
              update("listing_optimizer", { ...lst, priority_directories: v })
            }
            placeholder="Add directory"
          />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label>Sync frequency</Label>
            <Select
              value={lst.sync_frequency ?? "weekly"}
              onValueChange={(v) =>
                update("listing_optimizer", { ...lst, sync_frequency: v })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">daily</SelectItem>
                <SelectItem value="weekly">weekly</SelectItem>
                <SelectItem value="monthly">monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Alert triggers</Label>
            <PillList
              values={lst.alert_triggers ?? []}
              onChange={(v) =>
                update("listing_optimizer", { ...lst, alert_triggers: v })
              }
              placeholder="e.g. NAP mismatch"
            />
          </div>
        </div>
      </Section>

      <div className="fixed bottom-0 right-0 left-64 bg-white border-t border-slate-200 px-6 py-3 flex items-center justify-end gap-3 z-10">
        {dirty && (
          <span className="text-sm text-amber-600">Unsaved changes</span>
        )}
        <Button
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
