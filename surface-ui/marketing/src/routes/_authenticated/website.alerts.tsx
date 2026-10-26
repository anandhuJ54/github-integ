import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@v3/shared/components/ui/button";
import { Input } from "@v3/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@v3/shared/components/ui/select";
import {
  DataTable,
  EmptyState,
  PageBody,
  PageHeader,
  Panel,
  StatTile,
} from "@v3/shared/components/ui/console-primitives";
import { FieldRow, Pill } from "@v3/shared/public/components/website-bits";
import { loadAlerts, webMutations } from "@v3/marketing/utils/website";

const TYPES = ["info", "maintenance", "incident", "promo"];

export const Route = createFileRoute("/_authenticated/website/alerts")({
  head: () => ({
    meta: [
      { title: "Alerts — Website" },
      {
        name: "description",
        content:
          "Site-wide banner and alert manager: publish info, maintenance, incident or promo messages and switch them on or off instantly.",
      },
      { property: "og:title", content: "Alerts — Website" },
      { property: "og:description", content: "Site-wide banners for info, maintenance, incidents and promos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AlertsPage,
});

function AlertsPage() {
  const qc = useQueryClient();
  const { data: alerts, isLoading } = useQuery({ queryKey: ["web-alerts"], queryFn: loadAlerts });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["web-alerts"] });

  const [alertType, setAlertType] = useState("info");
  const [message, setMessage] = useState("");

  const create = useMutation({
    mutationFn: () => webMutations.createAlert({ alert_type: alertType, message: message.trim() }),
    onSuccess: () => {
      toast.success("Alert published");
      setMessage("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: (v: { id: string; active: boolean }) => webMutations.updateAlert(v.id, { active: v.active }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => webMutations.deleteAlert(id),
    onSuccess: () => {
      toast.success("Alert removed");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const list = alerts ?? [];
  const active = list.filter((a) => a.active).length;

  return (
    <PageBody>
      <PageHeader
        eyebrow="Website · Alerts"
        title="Site alerts"
        description="One switch for site-wide messaging. Publish a banner, flip it off when the situation clears — no deploy needed."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <StatTile label="Alerts" value={list.length} icon={<BellRing className="h-4 w-4" />} loading={isLoading} />
        <StatTile label="Active now" value={active} tone={active ? "yellow" : "green"} loading={isLoading} />
      </div>

      <Panel className="mt-6" title="New alert">
        <div className="grid gap-4 md:grid-cols-[180px_1fr_auto] md:items-end">
          <FieldRow label="Type">
            <Select value={alertType} onValueChange={setAlertType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="Message">
            <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Scheduled maintenance Sunday 02:00–04:00 UTC" />
          </FieldRow>
          <Button className="gap-1.5" disabled={!message.trim() || create.isPending} onClick={() => create.mutate()}>
            <Plus className="h-4 w-4" /> Publish
          </Button>
        </div>
      </Panel>

      <Panel className="mt-6" title="Alerts" bodyClassName="px-3 py-2">
        <DataTable
          columns={[
            { key: "type", header: "Type", cell: (a) => <Pill value={a.alert_type} /> },
            { key: "message", header: "Message", cell: (a) => <span className="text-ink">{a.message ?? "—"}</span> },
            { key: "state", header: "State", cell: (a) => <Pill value={a.active ? "active" : "paused"} /> },
            {
              key: "created",
              header: "Created",
              cell: (a) => (
                <span className="text-xs text-[color:var(--color-ink-2)]">
                  {a.created_at ? new Date(a.created_at).toLocaleDateString() : "—"}
                </span>
              ),
            },
            {
              key: "act",
              header: "",
              align: "right",
              cell: (a) => (
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => toggle.mutate({ id: a.id, active: !a.active })}>
                    {a.active ? "Deactivate" : "Activate"}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-[#c5221f]" onClick={() => remove.mutate(a.id)}>
                    Delete
                  </Button>
                </div>
              ),
            },
          ]}
          rows={list}
          getRowKey={(a) => a.id}
          loading={isLoading}
          empty={
            <EmptyState
              icon={<BellRing className="h-4 w-4" />}
              title="No alerts"
              description="Nothing is being announced on the site right now."
            />
          }
        />
      </Panel>
    </PageBody>
  );
}
