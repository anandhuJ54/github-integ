import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Users as UsersIcon,
  Search,
  UserPlus,
  ExternalLink,
  ShieldCheck,
  LogIn,
  Ban,
  Upload,
  ArrowLeft,
} from "lucide-react";
import { supabase } from "@v3/ui/integrations/supabase/client";
import { Card } from "@v3/ui/components/ui/card";
import { Badge } from "@v3/ui/components/ui/badge";
import { Button } from "@v3/ui/components/ui/button";
import { Input } from "@v3/ui/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@v3/ui/components/ui/avatar";
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
import { Textarea } from "@v3/ui/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/enterprise/$orgSlug/users")({
  ssr: false,
  component: EnterpriseUsersPage,
});

type Org = {
  id: string;
  name: string;
  slug: string;
  entity_type: string | null;
  parent_org_id: string | null;
  hierarchy_path: string | null;
  hierarchy_depth: number | null;
};

type Pro = {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  photo_url: string | null;
  email: string | null;
  user_id: string | null;
  primary_org_id: string | null;
  search_rank_score: number | null;
  claimed: boolean | null;
  is_active: boolean | null;
};

type RoleRow = {
  id: string;
  user_id: string;
  role: string;
  entity_type: string;
  entity_id: string;
  can_login_as: boolean | null;
  is_active: boolean | null;
};

type Acct = {
  supabase_user_id: string;
  email: string | null;
  last_login_at: string | null;
  is_active: boolean | null;
};

type Invite = {
  id: string;
  email: string;
  status: string;
  invited_at: string;
};

function EnterpriseUsersPage() {
  const { orgSlug } = Route.useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [adminUserId, setAdminUserId] = useState<string | null>(null);
  const [adminCanLoginAs, setAdminCanLoginAs] = useState(false);
  const [org, setOrg] = useState<Org | null>(null);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [pros, setPros] = useState<Pro[]>([]);
  const [rolesByUser, setRolesByUser] = useState<Map<string, RoleRow>>(new Map());
  const [accts, setAccts] = useState<Map<string, Acct>>(new Map());
  const [invites, setInvites] = useState<Invite[]>([]);

  const [q, setQ] = useState("");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [scoreFilter, setScoreFilter] = useState<string>("all");
  const [claimedFilter, setClaimedFilter] = useState<string>("all");

  const [inviteOpen, setInviteOpen] = useState(false);
  const [singleEmail, setSingleEmail] = useState("");
  const [singleName, setSingleName] = useState("");
  const [singleRole, setSingleRole] = useState("member");
  const [singleOrgId, setSingleOrgId] = useState<string>("");
  const [bulkCsv, setBulkCsv] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    setAdminUserId(session?.user.id ?? null);

    const { data: rootRow } = await supabase
      .from("organizations")
      .select("id,name,slug,entity_type,parent_org_id,hierarchy_path,hierarchy_depth")
      .eq("slug", orgSlug)
      .maybeSingle();
    if (!rootRow) {
      setLoading(false);
      return;
    }
    setOrg(rootRow as Org);
    setSingleOrgId(rootRow.id);

    const { data: descRows } = await supabase
      .from("organizations")
      .select("id,name,slug,entity_type,parent_org_id,hierarchy_path,hierarchy_depth")
      .like("hierarchy_path", `%${rootRow.id}%`);
    const allOrgs = [
      rootRow as Org,
      ...((descRows ?? []) as Org[]).filter((o) => o.id !== rootRow.id),
    ];
    setOrgs(allOrgs);
    const orgIds = allOrgs.map((o) => o.id);

    const [proRes, roleRes, inviteRes, adminRoleRes] = await Promise.all([
      supabase
        .from("professionals")
        .select(
          "id,display_name,first_name,last_name,photo_url,email,user_id,primary_org_id,search_rank_score,claimed,is_active",
        )
        .in("primary_org_id", orgIds)
        .limit(2000),
      supabase
        .from("user_roles")
        .select("id,user_id,role,entity_type,entity_id,can_login_as,is_active")
        .eq("entity_type", "organization")
        .in("entity_id", orgIds),
      supabase
        .from("invitations")
        .select("id,email,status,invited_at,entity_type,entity_id")
        .eq("entity_type", "organization")
        .in("entity_id", orgIds)
        .order("invited_at", { ascending: false })
        .limit(100),
      session?.user.id
        ? supabase
            .from("user_roles")
            .select("can_login_as")
            .eq("user_id", session.user.id)
            .eq("entity_type", "organization")
            .in("entity_id", orgIds)
            .eq("is_active", true)
        : Promise.resolve({ data: [] as Array<{ can_login_as: boolean | null }> }),
    ]);

    const proList = (proRes.data as Pro[]) ?? [];
    setPros(proList);

    const roleMap = new Map<string, RoleRow>();
    for (const r of ((roleRes.data ?? []) as RoleRow[])) {
      if (r.is_active === false) continue;
      const existing = roleMap.get(r.user_id);
      if (!existing) roleMap.set(r.user_id, r);
    }
    setRolesByUser(roleMap);

    setInvites(((inviteRes.data ?? []) as Invite[]));
    setAdminCanLoginAs(
      ((adminRoleRes.data ?? []) as Array<{ can_login_as: boolean | null }>).some(
        (r) => r.can_login_as,
      ),
    );

    const userIds = proList.map((p) => p.user_id).filter(Boolean) as string[];
    if (userIds.length) {
      const { data: acctRows } = await supabase
        .from("user_accounts")
        .select("supabase_user_id,email,last_login_at,is_active")
        .in("supabase_user_id", userIds);
      const map = new Map<string, Acct>();
      for (const a of ((acctRows ?? []) as Acct[])) map.set(a.supabase_user_id, a);
      setAccts(map);
    }

    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSlug]);

  const orgsById = useMemo(() => new Map(orgs.map((o) => [o.id, o])), [orgs]);

  const hierarchyLabel = (proOrgId: string | null): string => {
    if (!proOrgId) return "—";
    const o = orgsById.get(proOrgId);
    if (!o) return "—";
    // walk up to org root
    const chain: Org[] = [];
    let cur: Org | undefined = o;
    while (cur && cur.id !== org?.id) {
      chain.unshift(cur);
      cur = cur.parent_org_id ? orgsById.get(cur.parent_org_id) : undefined;
    }
    if (chain.length === 0) return o.name;
    return chain.map((c) => c.name).join(" › ");
  };

  const stats = useMemo(() => {
    const total = pros.length;
    const active = pros.filter((p) => {
      const a = p.user_id ? accts.get(p.user_id) : undefined;
      return a?.is_active !== false && p.is_active !== false;
    }).length;
    const invited = invites.filter((i) => i.status === "pending").length;
    const inactive = total - active;
    return { total, active, invited, inactive };
  }, [pros, accts, invites]);

  const tiers = useMemo(() => {
    const set = new Set<string>();
    for (const o of orgs) if (o.entity_type) set.add(o.entity_type);
    return Array.from(set);
  }, [orgs]);

  const roleOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rolesByUser.values()) set.add(r.role);
    return Array.from(set);
  }, [rolesByUser]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return pros.filter((p) => {
      const name = p.display_name || `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
      const acct = p.user_id ? accts.get(p.user_id) : undefined;
      const email = p.email || acct?.email || "";
      if (ql && !`${name} ${email}`.toLowerCase().includes(ql)) return false;
      if (tierFilter !== "all") {
        const o = p.primary_org_id ? orgsById.get(p.primary_org_id) : undefined;
        if (o?.entity_type !== tierFilter) return false;
      }
      if (roleFilter !== "all") {
        const role = p.user_id ? rolesByUser.get(p.user_id)?.role : undefined;
        if (role !== roleFilter) return false;
      }
      if (scoreFilter !== "all") {
        const s = p.search_rank_score ?? 0;
        const ok =
          (scoreFilter === "0-400" && s < 400) ||
          (scoreFilter === "400-650" && s >= 400 && s < 650) ||
          (scoreFilter === "650-800" && s >= 650 && s < 800) ||
          (scoreFilter === "800+" && s >= 800);
        if (!ok) return false;
      }
      if (claimedFilter !== "all") {
        if (claimedFilter === "yes" && !p.claimed) return false;
        if (claimedFilter === "no" && p.claimed) return false;
      }
      return true;
    });
  }, [pros, accts, rolesByUser, orgsById, q, tierFilter, roleFilter, scoreFilter, claimedFilter]);

  const submitSingleInvite = async () => {
    if (!singleEmail || !singleOrgId) {
      toast.error("Email and hierarchy placement required");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("invitations").insert({
      email: singleEmail,
      full_name: singleName || null,
      entity_type: "organization",
      entity_id: singleOrgId,
      role: singleRole,
      invited_by: adminUserId,
      status: "pending",
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    } as any);
    setSubmitting(false);
    if (error) {
      toast.error("Failed to send invite", { description: error.message });
      return;
    }
    toast.success(`Invite sent to ${singleEmail}`);
    setSingleEmail("");
    setSingleName("");
    setInviteOpen(false);
    load();
  };

  const submitBulkInvite = async () => {
    const rows = bulkCsv
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => !l.toLowerCase().startsWith("email,"));
    if (!rows.length) {
      toast.error("Paste CSV rows: email,full_name,role");
      return;
    }
    setSubmitting(true);
    const records = rows.map((line) => {
      const [email, full_name, role] = line.split(",").map((s) => s.trim());
      return {
        email,
        full_name: full_name || null,
        role: role || "member",
        entity_type: "organization",
        entity_id: singleOrgId,
        invited_by: adminUserId,
        status: "pending",
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      };
    });
    const { error } = await supabase.from("invitations").insert(records as any);
    setSubmitting(false);
    if (error) {
      toast.error("Bulk invite failed", { description: error.message });
      return;
    }
    toast.success(`Sent ${records.length} invitations`);
    setBulkCsv("");
    setInviteOpen(false);
    load();
  };

  const impersonate = async (p: Pro) => {
    if (!adminCanLoginAs || !adminUserId || !p.user_id) return;
    const { error } = await supabase.from("audit_log").insert({
      user_id: adminUserId,
      impersonating: p.user_id,
      action: "user.impersonate",
      entity_type: "professional",
      entity_id: p.id,
      field_changes: { org_slug: orgSlug },
    } as any);
    if (error) {
      toast.error("Could not start impersonation", { description: error.message });
      return;
    }
    toast.success(`Impersonating ${p.display_name ?? p.email}`);
  };

  const deactivate = async (p: Pro) => {
    const { error } = await supabase
      .from("professionals")
      .update({ is_active: false })
      .eq("id", p.id);
    if (error) {
      toast.error("Failed to deactivate", { description: error.message });
      return;
    }
    await supabase.from("audit_log").insert({
      user_id: adminUserId,
      action: "user.deactivate",
      entity_type: "professional",
      entity_id: p.id,
      field_changes: { is_active: false },
    } as any);
    toast.success("User deactivated");
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
              <h1 className="text-lg font-semibold truncate">Users</h1>
            </div>
          </div>
          <Button
            onClick={() => setInviteOpen(true)}
            className="bg-white text-slate-900 hover:bg-slate-100"
          >
            <UserPlus className="h-4 w-4 mr-1.5" /> Invite Users
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
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat label="Total Users" value={stats.total} />
              <Stat label="Active" value={stats.active} tone="emerald" />
              <Stat label="Invited" value={stats.invited} tone="blue" />
              <Stat label="Inactive" value={stats.inactive} tone="rose" />
            </div>

            {/* Filters */}
            <Card className="p-4 grid grid-cols-1 md:grid-cols-6 gap-3">
              <div className="relative md:col-span-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search name or email"
                  className="pl-9"
                />
              </div>
              <Select value={tierFilter} onValueChange={setTierFilter}>
                <SelectTrigger><SelectValue placeholder="Tier" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tiers</SelectItem>
                  {tiers.map((t) => (
                    <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger><SelectValue placeholder="Role" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  {roleOptions.map((r) => (
                    <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={scoreFilter} onValueChange={setScoreFilter}>
                <SelectTrigger><SelectValue placeholder="Score" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All scores</SelectItem>
                  <SelectItem value="0-400">0 – 400</SelectItem>
                  <SelectItem value="400-650">400 – 650</SelectItem>
                  <SelectItem value="650-800">650 – 800</SelectItem>
                  <SelectItem value="800+">800+</SelectItem>
                </SelectContent>
              </Select>
              <Select value={claimedFilter} onValueChange={setClaimedFilter}>
                <SelectTrigger><SelectValue placeholder="Claimed" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="yes">Claimed</SelectItem>
                  <SelectItem value="no">Unclaimed</SelectItem>
                </SelectContent>
              </Select>
            </Card>

            {/* Table */}
            <Card className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-500 border-b">
                  <tr>
                    <th className="text-left py-3 px-4 font-medium">User</th>
                    <th className="text-left py-3 px-4 font-medium">Email</th>
                    <th className="text-left py-3 px-4 font-medium">Role</th>
                    <th className="text-left py-3 px-4 font-medium">Hierarchy</th>
                    <th className="text-left py-3 px-4 font-medium w-40">Score</th>
                    <th className="text-left py-3 px-4 font-medium">Last active</th>
                    <th className="text-left py-3 px-4 font-medium">Claimed</th>
                    <th className="text-right py-3 px-4 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center text-slate-500 py-10">
                        No users match these filters.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((p) => {
                      const name =
                        p.display_name || `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "—";
                      const acct = p.user_id ? accts.get(p.user_id) : undefined;
                      const email = p.email || acct?.email || "—";
                      const role = p.user_id ? rolesByUser.get(p.user_id)?.role : null;
                      const score = p.search_rank_score ?? 0;
                      const lastActive = acct?.last_login_at
                        ? new Date(acct.last_login_at).toLocaleDateString()
                        : "—";
                      return (
                        <tr key={p.id} className="hover:bg-slate-50">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3">
                              <Avatar className="h-8 w-8">
                                {p.photo_url ? (
                                  <AvatarImage src={p.photo_url} alt={name} />
                                ) : null}
                                <AvatarFallback className="text-xs bg-slate-200 text-slate-700">
                                  {name.slice(0, 2).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <span className="font-medium text-slate-900">{name}</span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-slate-600">{email}</td>
                          <td className="py-3 px-4">
                            {role ? (
                              <Badge variant="secondary" className="bg-violet-100 text-violet-700 border-0 capitalize">
                                {role}
                              </Badge>
                            ) : (
                              <span className="text-slate-400 text-xs">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-slate-600 text-xs">
                            {hierarchyLabel(p.primary_org_id)}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-slate-100 rounded">
                                <div
                                  className="h-full bg-violet-500 rounded"
                                  style={{ width: `${Math.min(100, (score / 850) * 100)}%` }}
                                />
                              </div>
                              <span className="text-xs font-medium text-slate-700 w-8 text-right">
                                {score}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-slate-600 text-xs">{lastActive}</td>
                          <td className="py-3 px-4">
                            {p.claimed ? (
                              <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 border-0 gap-1">
                                <ShieldCheck className="h-3 w-3" /> Yes
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="bg-slate-100 text-slate-600 border-0">
                                No
                              </Badge>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center justify-end gap-1">
                              <Button size="sm" variant="ghost" asChild>
                                <a
                                  href={`/professionals/${p.id}`}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    toast.message("View profile", { description: name });
                                  }}
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => toast.message("Edit role", { description: name })}
                              >
                                Role
                              </Button>
                              {adminCanLoginAs && p.user_id ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => impersonate(p)}
                                  title="Login As"
                                >
                                  <LogIn className="h-3.5 w-3.5" />
                                </Button>
                              ) : null}
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => deactivate(p)}
                                title="Deactivate"
                                className="text-rose-600 hover:text-rose-700"
                              >
                                <Ban className="h-3.5 w-3.5" />
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
          </>
        )}
      </main>

      {/* Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-4 w-4" /> Invite users
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">
                Single invite
              </div>
              <div className="space-y-2">
                <Input
                  placeholder="Email"
                  type="email"
                  value={singleEmail}
                  onChange={(e) => setSingleEmail(e.target.value)}
                />
                <Input
                  placeholder="Full name (optional)"
                  value={singleName}
                  onChange={(e) => setSingleName(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Select value={singleRole} onValueChange={setSingleRole}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">Member</SelectItem>
                      <SelectItem value="branch_manager">Branch Manager</SelectItem>
                      <SelectItem value="region_manager">Region Manager</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={singleOrgId} onValueChange={setSingleOrgId}>
                    <SelectTrigger><SelectValue placeholder="Placement" /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      {orgs.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name}
                          {o.entity_type ? ` · ${o.entity_type}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={submitSingleInvite}
                  disabled={submitting}
                  className="w-full"
                >
                  Send invite
                </Button>
              </div>
            </div>

            <div className="border-t pt-5">
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-2 flex items-center gap-2">
                <Upload className="h-3.5 w-3.5" /> Bulk invite (CSV)
              </div>
              <p className="text-xs text-slate-500 mb-2">
                One per line: <code>email,full_name,role</code>
              </p>
              <Textarea
                rows={5}
                placeholder={"jane@acme.com,Jane Doe,member\njohn@acme.com,John Smith,branch_manager"}
                value={bulkCsv}
                onChange={(e) => setBulkCsv(e.target.value)}
              />
              <Button
                variant="outline"
                onClick={submitBulkInvite}
                disabled={submitting}
                className="w-full mt-2"
              >
                Send bulk invites
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setInviteOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "emerald" | "blue" | "rose";
}) {
  const colour =
    tone === "emerald"
      ? "text-emerald-600"
      : tone === "blue"
        ? "text-blue-600"
        : tone === "rose"
          ? "text-rose-600"
          : "text-slate-900";
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500 flex items-center gap-1">
        <UsersIcon className="h-3 w-3" /> {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${colour}`}>{value.toLocaleString()}</div>
    </Card>
  );
}
