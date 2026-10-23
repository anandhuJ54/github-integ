import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Inbox, Plus, Timer, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ConsoleTabs,
  DataTable,
  EmptyState,
  PageBody,
  PageHeader,
  Panel,
  StatTile,
} from "@/components/console/primitives";
import { FieldRow, InstrumentNote, Pill } from "@/components/website/bits";
import {
  LEAD_STATUSES,
  SLA_HOURS,
  isAging,
  leadTotals,
  loadForms,
  loadLeads,
  loadSellers,
  slaLabel,
  slugify,
  utmField,
  webMutations,
  type LeadStatus,
  type WebLead,
} from "@/lib/website";

export const Route = createFileRoute("/_authenticated/website/leads")({
  head: () => ({
    meta: [
      { title: "Leads — Website" },
      {
        name: "description",
        content:
          "The tracked lead engine: build capture forms, see every lead with its form, cohort and UTM attribution, route it to a seller with an SLA timer, and chase the unworked and aging queue.",
      },
      { property: "og:title", content: "Leads — Website" },
      {
        property: "og:description",
        content: "Form builder plus a routed, SLA-tracked lead inbox so no lead goes unworked.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LeadsPage,
});

function LeadsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["web-leads"],
    queryFn: async () => {
      const [leads, forms, sellers] = await Promise.all([loadLeads(), loadForms(), loadSellers()]);
      return { leads, forms, sellers };
    },
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["web-leads"] });

  const leads = data?.leads ?? [];
  const forms = data?.forms ?? [];
  const sellers = data?.sellers ?? [];
  const t = leadTotals(leads);

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [formFilter, setFormFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  const [agingOnly, setAgingOnly] = useState(false);

  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: LeadStatus }) => webMutations.setLeadStatus(v.id, v.status),
    onSuccess: () => {
      toast.success("Lead status updated");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const assign = useMutation({
    mutationFn: (v: { id: string; sellerId: string | null }) => webMutations.assignLead(v.id, v.sellerId),
    onSuccess: () => {
      toast.success("Lead routed");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sellerName = (id: string | null) => sellers.find((s) => s.id === id)?.name ?? null;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return leads.filter(
      (l) =>
        (statusFilter === "all" || (l.status ?? "new") === statusFilter) &&
        (formFilter === "all" || l.form_slug === formFilter) &&
        (!agingOnly || isAging(l)) &&
        (!needle ||
          [l.name, l.email, l.company, l.cohort].some((v) => (v ?? "").toLowerCase().includes(needle))),
    );
  }, [leads, statusFilter, formFilter, agingOnly, q]);

  const inbox = (
    <>
      <Panel
        title="Lead inbox"
        description={`Route every lead to a seller. SLA is ${SLA_HOURS}h from capture until the lead is worked.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search lead" className="h-8 w-48" />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All status</SelectItem>
                {LEAD_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={formFilter} onValueChange={setFormFilter}>
              <SelectTrigger className="h-8 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All forms</SelectItem>
                {forms.map((f) => (
                  <SelectItem key={f.id} value={f.slug ?? f.id}>
                    {f.name ?? f.slug}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-xs text-[color:var(--color-ink-2)]">
              <Switch checked={agingOnly} onCheckedChange={setAgingOnly} /> Unworked / aging only
            </label>
          </div>
        }
        bodyClassName="px-3 py-2"
      >
        <DataTable<WebLead>
          columns={[
            {
              key: "lead",
              header: "Lead",
              cell: (l) => (
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink">{l.name ?? l.email ?? "Unnamed"}</div>
                  <div className="truncate text-xs text-[color:var(--color-ink-3)]">
                    {[l.email, l.company].filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
              ),
            },
            { key: "form", header: "Form", cell: (l) => <span className="text-xs">{l.form_slug ?? "—"}</span> },
            { key: "cohort", header: "Cohort", cell: (l) => <span className="text-xs">{l.cohort ?? "—"}</span> },
            {
              key: "attr",
              header: "Attribution",
              cell: (l) => (
                <div className="text-xs leading-snug text-[color:var(--color-ink-2)]">
                  <div>
                    first: <span className="text-ink">{l.first_touch ?? utmField(l, "utm_source") ?? "—"}</span>
                  </div>
                  <div>
                    last: <span className="text-ink">{l.last_touch ?? utmField(l, "utm_medium") ?? "—"}</span>
                  </div>
                </div>
              ),
            },
            {
              key: "sla",
              header: "SLA",
              cell: (l) => (
                <span
                  className={
                    isAging(l)
                      ? "text-xs font-semibold text-[#c5221f]"
                      : "text-xs text-[color:var(--color-ink-2)]"
                  }
                >
                  {slaLabel(l)}
                </span>
              ),
            },
            {
              key: "assigned",
              header: "Assigned to",
              cell: (l) => (
                <Select
                  value={l.assigned_to ?? "unassigned"}
                  onValueChange={(v) => assign.mutate({ id: l.id, sellerId: v === "unassigned" ? null : v })}
                >
                  <SelectTrigger className="h-8 w-40">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {sellers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                        {s.role ? ` · ${s.role}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ),
            },
            {
              key: "status",
              header: "Status",
              cell: (l) => (
                <Select
                  value={(l.status ?? "new") as string}
                  onValueChange={(v) => setStatus.mutate({ id: l.id, status: v as LeadStatus })}
                >
                  <SelectTrigger className="h-8 w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEAD_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ),
            },
          ]}
          rows={rows}
          getRowKey={(l) => l.id}
          loading={isLoading}
          empty={
            <EmptyState
              icon={<Inbox className="h-4 w-4" />}
              title="No leads captured yet"
              description="Leads land here the moment a live form posts to exp_web_leads — with its form, cohort, UTM attribution and SLA timer."
            />
          }
        />
      </Panel>

      {leads.some((l) => l.assigned_to && sellerName(l.assigned_to)) ? null : (
        <div className="mt-4">
          <InstrumentNote>
            Routing is live and writes assignment + timestamp, but no lead has been routed yet. Sellers come
            from the sales roster, so any seller there can own a lead today.
          </InstrumentNote>
        </div>
      )}
    </>
  );

  return (
    <PageBody>
      <PageHeader
        eyebrow="Website · Leads"
        title="Lead engine"
        description="Capture, track, route and chase. Every lead carries its source form, cohort and attribution, gets an owner and an SLA clock, and is visible until it is worked — no more silent inbox."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Total leads" value={t.total} icon={<Inbox className="h-4 w-4" />} loading={isLoading} />
        <StatTile label="New" value={t.news} tone="blue" hint={`${t.unassigned} unassigned`} loading={isLoading} />
        <StatTile
          label="Aging past SLA"
          value={t.aging}
          tone={t.aging ? "red" : "green"}
          icon={<Timer className="h-4 w-4" />}
          loading={isLoading}
        />
        <StatTile
          label="Ignored"
          value={t.ignored}
          hint={`${t.ignoredPct.toFixed(0)}% of all leads`}
          tone={t.ignored ? "yellow" : "neutral"}
          icon={<AlertTriangle className="h-4 w-4" />}
          loading={isLoading}
        />
        <StatTile
          label="Conversion"
          value={`${t.conversionPct.toFixed(1)}%`}
          hint={`${t.qualified} qualified · ${t.contacted} contacted`}
          tone="green"
          icon={<UserCheck className="h-4 w-4" />}
          loading={isLoading}
        />
      </div>

      <div className="mt-8">
        <ConsoleTabs
          tabs={[
            { value: "inbox", label: "Lead inbox", content: inbox },
            { value: "forms", label: "Form builder", content: <FormBuilder /> },
          ]}
        />
      </div>
    </PageBody>
  );
}

function FormBuilder() {
  const qc = useQueryClient();
  const { data: forms, isLoading } = useQuery({ queryKey: ["web-forms"], queryFn: loadForms });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["web-forms"] });
    qc.invalidateQueries({ queryKey: ["web-leads"] });
  };

  const [name, setName] = useState("");
  const [destination, setDestination] = useState("");
  const [fields, setFields] = useState('[\n  { "name": "name", "label": "Full name", "type": "text", "required": true },\n  { "name": "email", "label": "Work email", "type": "email", "required": true }\n]');

  const create = useMutation({
    mutationFn: () => {
      let parsed: unknown = [];
      try {
        parsed = JSON.parse(fields);
      } catch {
        throw new Error("Fields must be valid JSON");
      }
      return webMutations.createForm({
        name: name.trim(),
        slug: slugify(name),
        destination: destination.trim() || null,
        fields: parsed as never,
      });
    },
    onSuccess: () => {
      toast.success("Form created");
      setName("");
      setDestination("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: (v: { id: string; active: boolean }) => webMutations.updateForm(v.id, { active: v.active }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => webMutations.deleteForm(id),
    onSuccess: () => {
      toast.success("Form deleted");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <Panel title="New capture form" description="Fields are a JSON array — name, label, type, required.">
        <div className="grid gap-4 md:grid-cols-2">
          <FieldRow label="Form name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Request a demo" />
          </FieldRow>
          <FieldRow label="Destination (routing hint)">
            <Input
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="enterprise-sdr / support / demo-center"
            />
          </FieldRow>
          <div className="md:col-span-2">
            <FieldRow label="Fields (JSON)">
              <Textarea rows={8} className="font-mono text-xs" value={fields} onChange={(e) => setFields(e.target.value)} />
            </FieldRow>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button className="gap-1.5" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
            <Plus className="h-4 w-4" /> Create form
          </Button>
          {name.trim() ? (
            <span className="text-xs text-[color:var(--color-ink-3)]">Slug: {slugify(name)}</span>
          ) : null}
        </div>
      </Panel>

      <Panel title="Forms" bodyClassName="px-3 py-2">
        <DataTable
          columns={[
            {
              key: "name",
              header: "Form",
              cell: (f) => (
                <div>
                  <div className="font-medium text-ink">{f.name ?? "Untitled"}</div>
                  <div className="text-xs text-[color:var(--color-ink-3)]">{f.slug}</div>
                </div>
              ),
            },
            { key: "dest", header: "Destination", cell: (f) => <span className="text-xs">{f.destination ?? "—"}</span> },
            {
              key: "fields",
              header: "Fields",
              align: "right",
              cell: (f) => (Array.isArray(f.fields) ? f.fields.length : 0),
            },
            { key: "state", header: "State", cell: (f) => <Pill value={f.active ? "active" : "paused"} /> },
            {
              key: "act",
              header: "",
              align: "right",
              cell: (f) => (
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => toggle.mutate({ id: f.id, active: !f.active })}>
                    {f.active ? "Deactivate" : "Activate"}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-[#c5221f]" onClick={() => remove.mutate(f.id)}>
                    Delete
                  </Button>
                </div>
              ),
            },
          ]}
          rows={forms ?? []}
          getRowKey={(f) => f.id}
          loading={isLoading}
          empty={
            <EmptyState
              compact
              title="No forms yet"
              description="Build the first capture form; its slug is what every lead is tagged with."
            />
          }
        />
      </Panel>
    </div>
  );
}
