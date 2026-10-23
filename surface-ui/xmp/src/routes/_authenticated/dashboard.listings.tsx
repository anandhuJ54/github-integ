import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  Wrench,
  Send,
  Plug,
  Globe,
} from "lucide-react";
import { supabase } from "@v3/ui/integrations/supabase/client";
import { Button } from "@v3/ui/components/ui/button";
import { Card } from "@v3/ui/components/ui/card";
import { Badge } from "@v3/ui/components/ui/badge";
import { Progress } from "@v3/xmp/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@v3/ui/components/ui/tooltip";
import { toast } from "sonner";
import { DashboardShell } from "@v3/xmp/components/dashboard-shell";
import { loadOfficeMode } from "@v3/xmp/lib/office-mode";
import { listingSubject } from "@v3/xmp/lib/listings/subject";

export const Route = createFileRoute("/_authenticated/dashboard/listings")({
  ssr: false,
  component: ListingsPage,
});

type Professional = {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  photo_url: string | null;
  gcid: string | null;
};

type Listing = {
  id: string;
  directory_key: string;
  directory_name: string | null;
  directory_url: string | null;
  status: string | null;
  listing_url: string | null;
  last_verified: string | null;
  last_submitted: string | null;
  has_drift: boolean | null;
  drift_fields: string[] | null;
  score_points: number | null;
  name_match: boolean | null;
  phone_match: boolean | null;
  address_match: boolean | null;
};

type Registry = {
  id: string;
  node_name: string;
  node_slug: string;
  connection_method: string | null;
  score_points: number | null;
  priority: number | null;
  url_pattern: string | null;
  ring: string;
};

type Row = {
  key: string;
  name: string;
  registry: Registry | null;
  listing: Listing | null;
  priority: number;
  scorePoints: number;
  status: string;
  connectionMethod: string | null;
};

const STATUS_META: Record<string, { label: string; cls: string; icon: any }> = {
  published: { label: "Published", cls: "bg-emerald-100 text-emerald-700", icon: CheckCircle2 },
  pending: { label: "Pending", cls: "bg-amber-100 text-amber-700", icon: Clock },
  ready: { label: "Ready", cls: "bg-blue-100 text-blue-700", icon: Send },
  error: { label: "Error", cls: "bg-rose-100 text-rose-700", icon: XCircle },
  not_submitted: { label: "Not Submitted", cls: "bg-slate-100 text-slate-600", icon: Globe },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.not_submitted;
  const Icon = meta.icon;
  return (
    <Badge variant="secondary" className={`${meta.cls} border-0 gap-1`}>
      <Icon className="h-3 w-3" /> {meta.label}
    </Badge>
  );
}

function ListingsPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [pro, setPro] = useState<Professional | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [registry, setRegistry] = useState<Registry[]>([]);

  const load = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      navigate({ to: "/auth" as any });
      return;
    }
    const { data: proRow } = await supabase
      .from("professionals")
      .select("id,display_name,first_name,last_name,photo_url,gcid")
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (!proRow) {
      setLoading(false);
      return;
    }
    setPro(proRow as Professional);

    // Single-pro office: listings belong to the location (exp_office_mode, 0027). Until 0027 is
    // applied the mode is null and the professional's own rows are read, as before.
    const subject = listingSubject(
      { entityType: "professional", entityId: proRow.id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await loadOfficeMode(supabase as any, "professional", proRow.id),
    );

    const [{ data: lst }, { data: reg }] = await Promise.all([
      supabase
        .from("listings")
        .select(
          "id,directory_key,directory_name,directory_url,status,listing_url,last_verified,last_submitted,has_drift,drift_fields,score_points,name_match,phone_match,address_match",
        )
        .eq("entity_type", subject.entityType)
        .eq("entity_id", subject.entityId),
      proRow.gcid
        ? supabase
            .from("exp_vertical_node_registry")
            .select(
              "id,node_name,node_slug,connection_method,score_points,priority,url_pattern,ring",
            )
            .eq("gcid", proRow.gcid)
            // Rings are named (identity, presence, …); the old "ring_2" literal matched nothing.
            .eq("ring", "presence")
            .eq("is_active", true)
            .order("priority", { ascending: true })
        : Promise.resolve({ data: [] as Registry[] }),
    ]);
    setListings((lst as Listing[]) ?? []);
    setRegistry((reg as Registry[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows: Row[] = useMemo(() => {
    const byKey = new Map<string, Listing>();
    for (const l of listings) byKey.set(l.directory_key, l);

    const out: Row[] = registry.map((r) => {
      const listing = byKey.get(r.node_slug) ?? null;
      if (listing) byKey.delete(r.node_slug);
      return {
        key: r.node_slug,
        name: r.node_name,
        registry: r,
        listing,
        priority: r.priority ?? 99,
        scorePoints: listing?.score_points ?? r.score_points ?? 0,
        status: listing?.status ?? "not_submitted",
        connectionMethod: r.connection_method,
      };
    });

    // listings that exist but aren't in the registry
    for (const l of byKey.values()) {
      out.push({
        key: l.directory_key,
        name: l.directory_name ?? l.directory_key,
        registry: null,
        listing: l,
        priority: 99,
        scorePoints: l.score_points ?? 0,
        status: l.status ?? "not_submitted",
        connectionMethod: null,
      });
    }

    return out.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  }, [listings, registry]);

  const stats = useMemo(() => {
    const tracked = rows.length;
    const published = rows.filter((r) => r.status === "published").length;
    const pending = rows.filter((r) => r.status === "pending").length;
    const drift = rows.filter((r) => r.listing?.has_drift).length;
    const coverage = registry.length || rows.length || 61;
    return { tracked, published, pending, drift, coverage };
  }, [rows, registry]);

  const readyToPublish = rows.filter((r) => r.status === "ready");

  // Publish All / Fix Drift used to flip listings flags (status → pending, has_drift → false)
  // without submitting anything to a publisher. They stay visible but disabled until the
  // publisher connectors exist; status transitions belong to src/lib/listings/status.ts.

  const connect = (row: Row) => {
    toast.message(`Connect ${row.name}`, {
      description: `OAuth flow for ${row.connectionMethod ?? "this directory"} not yet configured.`,
    });
  };

  return (
    <DashboardShell title="Listings" currentPath="/dashboard/listings" user={pro ?? undefined}>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Listings</h2>
          <p className="text-sm text-slate-500">
            Presence ring — directory profiles that feed your expertise graph.
          </p>
        </div>

        {loading ? (
          <div className="text-sm text-slate-500">Loading…</div>
        ) : !pro ? (
          <Card className="p-6 text-sm text-slate-600">No professional profile found.</Card>
        ) : (
          <>
            {/* Stats bar */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Total sites tracked" value={stats.tracked} />
              <StatCard label="Published" value={stats.published} tone="emerald" />
              <StatCard label="Pending" value={stats.pending} tone="amber" />
              <StatCard label="Has Drift" value={stats.drift} tone="rose" />
            </div>

            {/* Coverage */}
            <Card className="p-5">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-slate-900">
                  Your listing coverage: {stats.published}/{stats.coverage} sites
                </div>
                <div className="flex gap-2">
                  <ConnectorNotBuilt>
                    <Button size="sm" disabled>
                      <Send className="h-4 w-4 mr-1.5" />
                      Publish All {readyToPublish.length ? `(${readyToPublish.length})` : ""}
                    </Button>
                  </ConnectorNotBuilt>
                </div>
              </div>
              <Progress value={stats.coverage ? (stats.published / stats.coverage) * 100 : 0} />
            </Card>

            {/* Directory list */}
            <Card className="divide-y">
              {rows.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  No directories configured for your category yet.
                </div>
              ) : (
                rows.map((row) => (
                  <DirectoryRow key={row.key} row={row} onConnect={() => connect(row)} />
                ))
              )}
            </Card>
          </>
        )}
      </div>
    </DashboardShell>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "emerald" | "amber" | "rose";
}) {
  const colour =
    tone === "emerald"
      ? "text-emerald-600"
      : tone === "amber"
        ? "text-amber-600"
        : tone === "rose"
          ? "text-rose-600"
          : "text-slate-900";
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${colour}`}>{value}</div>
    </Card>
  );
}

/** Disabled buttons swallow pointer events, so the tooltip hangs off a focusable wrapper. */
function ConnectorNotBuilt({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex">
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent>Connector not built</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function DirectoryRow({ row, onConnect }: { row: Row; onConnect: () => void }) {
  const isOauth =
    row.connectionMethod === "oauth" ||
    row.connectionMethod === "api" ||
    row.key === "gbp" ||
    row.key === "google_business_profile";
  const verified = row.listing?.last_verified
    ? new Date(row.listing.last_verified).toLocaleDateString()
    : "—";
  const drift = !!row.listing?.has_drift;
  const initials = row.name.slice(0, 2).toUpperCase();

  return (
    <div className="p-4 flex flex-col md:flex-row md:items-center gap-4">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="h-10 w-10 rounded-md bg-slate-100 text-slate-700 flex items-center justify-center text-xs font-semibold shrink-0">
          {initials}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-sm font-medium text-slate-900 truncate">{row.name}</div>
            <StatusBadge status={row.status} />
            {drift ? (
              <Badge variant="secondary" className="bg-orange-100 text-orange-700 border-0 gap-1">
                <AlertTriangle className="h-3 w-3" /> Drift
              </Badge>
            ) : null}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            Last verified {verified}
            {drift && row.listing?.drift_fields?.length
              ? ` · fields: ${row.listing.drift_fields.join(", ")}`
              : ""}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 md:gap-4 shrink-0">
        <div className="text-right">
          <div className="text-xs text-slate-500">Score</div>
          <div className="text-sm font-semibold text-slate-900">+{row.scorePoints}</div>
        </div>
        <div className="flex items-center gap-2">
          {isOauth && row.status === "not_submitted" ? (
            <Button size="sm" variant="outline" onClick={onConnect}>
              <Plug className="h-4 w-4 mr-1.5" /> Connect
            </Button>
          ) : null}
          {drift ? (
            <ConnectorNotBuilt>
              <Button size="sm" variant="outline" disabled>
                <Wrench className="h-4 w-4 mr-1.5" /> Fix Drift
              </Button>
            </ConnectorNotBuilt>
          ) : null}
          {row.listing?.listing_url ? (
            <Button size="sm" variant="outline" asChild>
              <a href={row.listing.listing_url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4 mr-1.5" /> View
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
