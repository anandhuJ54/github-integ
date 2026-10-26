import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Plus,
  Megaphone,
  Mail,
  MessageSquare,
  QrCode,
  ShieldCheck,
  ShieldAlert,
  Pause,
  Copy,
  Eye,
  Pencil,
  Star,
  ClipboardList,
  Share2,
  CheckCircle2,
  Send,
} from "lucide-react";
import { api } from "@v3/state/api/server-fn";
import { Card } from "@v3/shared/components/ui/card";
import { Badge } from "@v3/shared/components/ui/badge";
import { Button } from "@v3/shared/components/ui/button";
import { Input } from "@v3/shared/components/ui/input";
import { Textarea } from "@v3/shared/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@v3/shared/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@v3/shared/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@v3/shared/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/enterprise/$orgSlug/campaigns")({
  ssr: false,
  component: CampaignsPage,
});

type Org = {
  id: string;
  name: string;
  slug: string;
  entity_type: string | null;
  gcid: string | null;
  hierarchy_path: string | null;
};

type Campaign = {
  id: string;
  entity_type: string;
  entity_id: string;
  name: string;
  campaign_type: string | null;
  status: string | null;
  subject: string | null;
  message_body: string | null;
  target_platform: string | null;
  sent_count: number | null;
  opened_count: number | null;
  clicked_count: number | null;
  completed_count: number | null;
  compliance_approved: boolean | null;
  includes_required_disclosures: boolean | null;
  created_at: string;
};

type Rule = {
  id: string;
  rule_name: string;
  rule_type: string;
  rule_value: string;
  applies_to: string[] | null;
  severity: string | null;
};

type ComplianceFinding = {
  rule: Rule;
  passed: boolean;
  detail?: string;
};

const TABS = [
  { id: "review", label: "Review Campaigns", icon: Star },
  { id: "survey", label: "Survey Campaigns", icon: ClipboardList },
  { id: "social", label: "Social Campaigns", icon: Share2 },
  { id: "draft", label: "Draft", icon: Pencil },
] as const;

type TabId = (typeof TABS)[number]["id"];

function CampaignsPage() {
  const { orgSlug } = Route.useParams();
  const [loading, setLoading] = useState(true);
  const [org, setOrg] = useState<Org | null>(null);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [tab, setTab] = useState<TabId>("review");
  const [builderOpen, setBuilderOpen] = useState(false);

  const load = async () => {
    // the org, the orgs under it (hierarchy_path), their campaigns and the active compliance
    // rules for its gcid (server side; errors were ignored)
    const data = await api.get<{
      root: Org | null;
      descendants?: Org[];
      campaigns?: Campaign[];
      rules?: Rule[];
    }>(`/campaigns/enterprise/orgs/${encodeURIComponent(orgSlug)}/campaigns`);
    const rootRow = data.root;
    if (!rootRow) {
      setLoading(false);
      return;
    }
    setOrg(rootRow);

    const descRows = data.descendants;
    const allOrgs = [
      rootRow as Org,
      ...((descRows ?? []) as Org[]).filter((o) => o.id !== rootRow.id),
    ];
    setOrgs(allOrgs);

    const campRes = { data: data.campaigns };
    const ruleRes = { data: data.rules };

    setCampaigns(((campRes.data ?? []) as Campaign[]));
    setRules(((ruleRes.data ?? []) as Rule[]));
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSlug]);

  const stats = useMemo(() => {
    const active = campaigns.filter((c) => c.status === "active" || c.status === "running").length;
    const sent = campaigns.reduce((s, c) => s + (c.sent_count ?? 0), 0);
    const completed = campaigns.reduce((s, c) => s + (c.completed_count ?? 0), 0);
    const avg = sent > 0 ? (completed / sent) * 100 : 0;
    const reviews = campaigns
      .filter((c) => c.campaign_type === "review")
      .reduce((s, c) => s + (c.completed_count ?? 0), 0);
    return { active, sent, avg, reviews };
  }, [campaigns]);

  const visible = useMemo(() => {
    if (tab === "draft") return campaigns.filter((c) => c.status === "draft");
    return campaigns.filter((c) => (c.campaign_type ?? "review") === tab);
  }, [campaigns, tab]);

  const updateStatus = async (c: Campaign, status: string) => {
    const error = await api
      .patch(`/campaigns/enterprise/campaigns/${encodeURIComponent(c.id)}`, { status })
      .then(() => null, (e: Error) => e);
    if (error) return toast.error("Failed to update", { description: error.message });
    toast.success(`Campaign ${status}`);
    load();
  };

  const duplicate = async (c: Campaign) => {
    const error = await api.post("/campaigns/enterprise/campaigns", {
      entity_type: c.entity_type,
      entity_id: c.entity_id,
      name: `${c.name} (Copy)`,
      campaign_type: c.campaign_type,
      status: "draft",
      subject: c.subject,
      message_body: c.message_body,
      target_platform: c.target_platform,
      compliance_approved: false,
      includes_required_disclosures: c.includes_required_disclosures,
    }).then(() => null, (e: Error) => e);
    if (error) return toast.error("Duplicate failed", { description: error.message });
    toast.success("Duplicated as draft");
    load();
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              to="/enterprise/$orgSlug"
              params={{ orgSlug }}
              className="text-slate-400 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wider text-slate-400">
                {org?.name ?? "Enterprise"}
              </div>
              <h1 className="text-lg font-semibold truncate">Campaigns</h1>
            </div>
          </div>
          <Button
            onClick={() => setBuilderOpen(true)}
            className="bg-white text-slate-900 hover:bg-slate-100"
          >
            <Plus className="h-4 w-4 mr-1.5" /> New Campaign
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {loading ? (
          <div className="text-sm text-slate-500">Loading…</div>
        ) : !org ? (
          <Card className="p-6 text-sm">Organization not found.</Card>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat
                label="Active Campaigns"
                value={stats.active.toLocaleString()}
                icon={Megaphone}
              />
              <Stat label="Total Sent" value={stats.sent.toLocaleString()} icon={Send} />
              <Stat
                label="Avg Completion"
                value={`${stats.avg.toFixed(1)}%`}
                icon={CheckCircle2}
                tone="emerald"
              />
              <Stat
                label="Reviews Collected"
                value={stats.reviews.toLocaleString()}
                icon={Star}
                tone="amber"
              />
            </div>

            <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
              <TabsList className="bg-white border">
                {TABS.map((t) => {
                  const Icon = t.icon;
                  return (
                    <TabsTrigger key={t.id} value={t.id} className="gap-2">
                      <Icon className="h-3.5 w-3.5" /> {t.label}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>

            <Card className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-500 border-b">
                  <tr>
                    <th className="text-left py-3 px-4 font-medium">Campaign</th>
                    <th className="text-left py-3 px-4 font-medium">Type</th>
                    <th className="text-left py-3 px-4 font-medium">Status</th>
                    <th className="text-right py-3 px-4 font-medium">Sent</th>
                    <th className="text-right py-3 px-4 font-medium">Opened</th>
                    <th className="text-right py-3 px-4 font-medium">Completed</th>
                    <th className="text-right py-3 px-4 font-medium">Completion</th>
                    <th className="text-left py-3 px-4 font-medium">Compliance</th>
                    <th className="text-right py-3 px-4 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {visible.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center text-slate-500 py-10">
                        No campaigns in this tab.
                      </td>
                    </tr>
                  ) : (
                    visible.map((c) => {
                      const sent = c.sent_count ?? 0;
                      const completed = c.completed_count ?? 0;
                      const pct = sent > 0 ? (completed / sent) * 100 : 0;
                      return (
                        <tr key={c.id} className="hover:bg-slate-50">
                          <td className="py-3 px-4 font-medium text-slate-900">{c.name}</td>
                          <td className="py-3 px-4 capitalize text-slate-600">
                            <Badge variant="secondary" className="bg-violet-100 text-violet-700 border-0 capitalize">
                              {c.campaign_type ?? "—"}
                            </Badge>
                          </td>
                          <td className="py-3 px-4">
                            <StatusBadge status={c.status} />
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums">{sent.toLocaleString()}</td>
                          <td className="py-3 px-4 text-right tabular-nums">{(c.opened_count ?? 0).toLocaleString()}</td>
                          <td className="py-3 px-4 text-right tabular-nums">{completed.toLocaleString()}</td>
                          <td className="py-3 px-4 text-right tabular-nums">
                            {pct.toFixed(1)}%
                          </td>
                          <td className="py-3 px-4">
                            {c.compliance_approved ? (
                              <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 border-0 gap-1">
                                <ShieldCheck className="h-3 w-3" /> Approved
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="bg-amber-100 text-amber-700 border-0 gap-1">
                                <ShieldAlert className="h-3 w-3" /> Pending
                              </Badge>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center justify-end gap-1">
                              <Button size="sm" variant="ghost" title="View">
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="sm" variant="ghost" title="Edit">
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                title="Duplicate"
                                onClick={() => duplicate(c)}
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </Button>
                              {c.status === "active" || c.status === "running" ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  title="Pause"
                                  onClick={() => updateStatus(c, "paused")}
                                >
                                  <Pause className="h-3.5 w-3.5" />
                                </Button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </main>

      {org ? (
        <CampaignBuilder
          open={builderOpen}
          onOpenChange={setBuilderOpen}
          org={org}
          orgs={orgs}
          rules={rules}
          onCreated={load}
        />
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: typeof Megaphone;
  tone?: "emerald" | "amber";
}) {
  const colour =
    tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : "text-slate-900";
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${colour}`}>{value}</div>
    </Card>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  const s = status ?? "draft";
  const map: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-700",
    running: "bg-emerald-100 text-emerald-700",
    draft: "bg-slate-100 text-slate-600",
    paused: "bg-amber-100 text-amber-700",
    completed: "bg-blue-100 text-blue-700",
    archived: "bg-slate-100 text-slate-500",
  };
  return (
    <Badge variant="secondary" className={`${map[s] ?? "bg-slate-100 text-slate-600"} border-0 capitalize`}>
      {s}
    </Badge>
  );
}

/* --- Builder --- */

const STEPS = [
  "Type",
  "Message",
  "Delivery",
  "Audience",
  "Compliance",
  "Launch",
] as const;

function runCompliance(text: string, rules: Rule[]): ComplianceFinding[] {
  const findings: ComplianceFinding[] = [];
  for (const rule of rules) {
    if (rule.applies_to && rule.applies_to.length && !rule.applies_to.includes("campaign")) {
      continue;
    }
    const value = (rule.rule_value ?? "").toLowerCase();
    const lower = text.toLowerCase();
    let passed = true;
    let detail: string | undefined;
    if (rule.rule_type === "banned_word" || rule.rule_type === "banned_phrase") {
      if (value && lower.includes(value)) {
        passed = false;
        detail = `Contains forbidden term "${rule.rule_value}"`;
      }
    } else if (rule.rule_type === "required_disclosure" || rule.rule_type === "required_phrase") {
      if (value && !lower.includes(value)) {
        passed = false;
        detail = `Missing required disclosure: "${rule.rule_value}"`;
      }
    } else if (rule.rule_type === "regex") {
      try {
        const re = new RegExp(rule.rule_value, "i");
        if (re.test(text)) {
          passed = false;
          detail = `Matches restricted pattern`;
        }
      } catch {
        /* invalid regex — skip */
      }
    } else {
      // generic substring check fallback
      if (value && lower.includes(value)) {
        passed = false;
        detail = `Flagged by rule "${rule.rule_name}"`;
      }
    }
    findings.push({ rule, passed, detail });
  }
  return findings;
}

function CampaignBuilder({
  open,
  onOpenChange,
  org,
  orgs,
  rules,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  org: Org;
  orgs: Org[];
  rules: Rule[];
  onCreated: () => void;
}) {
  const [step, setStep] = useState(0);
  const [type, setType] = useState<"review" | "survey" | "social">("review");
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("Hi {{first_name}},\n\nWould you share a quick review of your experience?\n\n— {{pro_name}}");
  const [delivery, setDelivery] = useState<"email" | "sms" | "qr">("email");
  const [audience, setAudience] = useState<string>("all");
  const [audienceOrgId, setAudienceOrgId] = useState<string>(org.id);
  const [findings, setFindings] = useState<ComplianceFinding[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setStep(0);
      setFindings(null);
    }
  }, [open]);

  const compliancePass = findings ? findings.every((f) => f.passed) : false;

  const runCheck = () => {
    const text = `${subject}\n${body}`;
    setFindings(runCompliance(text, rules));
  };

  const launch = async (asDraft: boolean) => {
    if (!name.trim()) {
      toast.error("Campaign needs a name");
      return;
    }
    setSubmitting(true);
    const entityId =
      audience === "branch" || audience === "tier" ? audienceOrgId : org.id;
    const error = await api.post("/campaigns/enterprise/campaigns", {
      entity_type: "organization",
      entity_id: entityId,
      name,
      campaign_type: type,
      status: asDraft ? "draft" : "active",
      subject,
      message_body: body,
      target_platform: delivery,
      sent_count: 0,
      opened_count: 0,
      clicked_count: 0,
      completed_count: 0,
      compliance_approved: compliancePass,
      includes_required_disclosures: compliancePass,
    }).then(() => null, (e: Error) => e);
    setSubmitting(false);
    if (error) return toast.error("Failed to create campaign", { description: error.message });
    toast.success(asDraft ? "Saved as draft" : "Campaign launched");
    onOpenChange(false);
    onCreated();
  };

  const tiers = useMemo(
    () => Array.from(new Set(orgs.map((o) => o.entity_type).filter(Boolean))) as string[],
    [orgs],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Campaign</DialogTitle>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center gap-1 text-xs">
          {STEPS.map((label, i) => (
            <div key={label} className="flex-1 flex items-center gap-1">
              <div
                className={`flex-1 h-1 rounded ${i <= step ? "bg-violet-500" : "bg-slate-200"}`}
              />
              <span
                className={`${i === step ? "text-slate-900 font-medium" : "text-slate-400"} whitespace-nowrap`}
              >
                {i + 1}. {label}
              </span>
            </div>
          ))}
        </div>

        <div className="min-h-[280px] py-2">
          {step === 0 ? (
            <div className="grid grid-cols-3 gap-3">
              {([
                { id: "review", label: "Review", icon: Star, desc: "Collect verified reviews" },
                { id: "survey", label: "Survey", icon: ClipboardList, desc: "Gather structured feedback" },
                { id: "social", label: "Social", icon: Share2, desc: "Encourage social shares" },
              ] as const).map((t) => {
                const Icon = t.icon;
                const active = type === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setType(t.id)}
                    className={`text-left rounded-lg border p-4 transition ${
                      active ? "border-violet-500 bg-violet-50" : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <Icon className="h-5 w-5 text-violet-600 mb-2" />
                    <div className="font-medium text-slate-900">{t.label}</div>
                    <div className="text-xs text-slate-500 mt-1">{t.desc}</div>
                  </button>
                );
              })}
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-3">
              <Input
                placeholder="Campaign name (internal)"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Input
                placeholder="Subject line"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
              <Textarea
                rows={8}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
              <div className="text-xs text-slate-500">
                Dynamic fields:{" "}
                <code className="px-1 bg-slate-100 rounded">{`{{first_name}}`}</code>{" "}
                <code className="px-1 bg-slate-100 rounded">{`{{pro_name}}`}</code>{" "}
                <code className="px-1 bg-slate-100 rounded">{`{{review_url}}`}</code>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="grid grid-cols-3 gap-3">
              {([
                { id: "email", label: "Email", icon: Mail },
                { id: "sms", label: "SMS", icon: MessageSquare },
                { id: "qr", label: "QR Code", icon: QrCode },
              ] as const).map((d) => {
                const Icon = d.icon;
                const active = delivery === d.id;
                return (
                  <button
                    key={d.id}
                    onClick={() => setDelivery(d.id)}
                    className={`rounded-lg border p-4 transition ${
                      active ? "border-violet-500 bg-violet-50" : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <Icon className="h-5 w-5 mx-auto text-violet-600 mb-2" />
                    <div className="font-medium text-slate-900">{d.label}</div>
                  </button>
                );
              })}
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-3">
              <div className="text-sm font-medium text-slate-700">Who should receive this?</div>
              <Select value={audience} onValueChange={setAudience}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All users in {org.name}</SelectItem>
                  <SelectItem value="branch">Specific branch / location</SelectItem>
                  <SelectItem value="tier">Specific hierarchy tier</SelectItem>
                </SelectContent>
              </Select>
              {audience === "branch" ? (
                <Select value={audienceOrgId} onValueChange={setAudienceOrgId}>
                  <SelectTrigger><SelectValue placeholder="Choose branch" /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {orgs.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.name}
                        {o.entity_type ? ` · ${o.entity_type}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              {audience === "tier" ? (
                <Select value={audienceOrgId} onValueChange={setAudienceOrgId}>
                  <SelectTrigger><SelectValue placeholder="Choose tier" /></SelectTrigger>
                  <SelectContent>
                    {tiers.map((t) => (
                      <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
          ) : null}

          {step === 4 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-slate-700">
                  Compliance check ({rules.length} rule{rules.length === 1 ? "" : "s"} for this category)
                </div>
                <Button size="sm" variant="outline" onClick={runCheck}>
                  Run check
                </Button>
              </div>
              {!findings ? (
                <div className="text-sm text-slate-500 border rounded p-4">
                  Click "Run check" to validate your message against compliance rules.
                </div>
              ) : (
                <div className="space-y-2">
                  <div
                    className={`rounded p-3 text-sm font-medium ${
                      compliancePass ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                    }`}
                  >
                    {compliancePass ? "All compliance rules passed." : "Compliance issues found."}
                  </div>
                  <div className="space-y-1 max-h-52 overflow-y-auto">
                    {findings.length === 0 ? (
                      <div className="text-xs text-slate-500">No applicable rules.</div>
                    ) : (
                      findings.map((f) => (
                        <div
                          key={f.rule.id}
                          className="flex items-start gap-2 text-xs border rounded p-2"
                        >
                          {f.passed ? (
                            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 mt-0.5" />
                          ) : (
                            <ShieldAlert className="h-3.5 w-3.5 text-rose-600 mt-0.5" />
                          )}
                          <div>
                            <div className="font-medium text-slate-800">{f.rule.rule_name}</div>
                            {f.detail ? (
                              <div className="text-slate-500">{f.detail}</div>
                            ) : (
                              <div className="text-slate-400">Passed</div>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {step === 5 ? (
            <div className="space-y-3 text-sm">
              <Row label="Type" value={type} capitalize />
              <Row label="Name" value={name || "—"} />
              <Row label="Subject" value={subject || "—"} />
              <Row label="Delivery" value={delivery} capitalize />
              <Row
                label="Audience"
                value={
                  audience === "all"
                    ? `All users in ${org.name}`
                    : audience === "branch"
                      ? orgs.find((o) => o.id === audienceOrgId)?.name ?? "—"
                      : audienceOrgId
                }
                capitalize={audience === "tier"}
              />
              <Row
                label="Compliance"
                value={compliancePass ? "Approved" : "Pending"}
                tone={compliancePass ? "emerald" : "amber"}
              />
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t pt-3">
          <Button
            variant="ghost"
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            Back
          </Button>
          <div className="flex items-center gap-2">
            {step === STEPS.length - 1 ? (
              <>
                <Button variant="outline" disabled={submitting} onClick={() => launch(true)}>
                  Save draft
                </Button>
                <Button disabled={submitting || !compliancePass} onClick={() => launch(false)}>
                  Launch campaign
                </Button>
              </>
            ) : (
              <Button onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>
                Next
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  value,
  capitalize,
  tone,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
  tone?: "emerald" | "amber";
}) {
  const colour =
    tone === "emerald"
      ? "text-emerald-700"
      : tone === "amber"
        ? "text-amber-700"
        : "text-slate-900";
  return (
    <div className="flex items-start justify-between gap-4 border-b pb-2">
      <span className="text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <span className={`${colour} ${capitalize ? "capitalize" : ""} text-right`}>{value}</span>
    </div>
  );
}
