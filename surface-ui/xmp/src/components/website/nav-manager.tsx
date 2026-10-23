import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyPlus, Link2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@v3/ui/components/ui/button";
import { Input } from "@v3/ui/components/ui/input";
import { Textarea } from "@v3/ui/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@v3/ui/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@v3/ui/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@v3/ui/components/ui/tabs";
import { DataTable, DetailDrawer, EmptyState, Panel } from "@v3/ui/components/console/primitives";
import { FieldRow, Pill } from "@v3/ui/components/website/bits";
import { NavVisualEditor } from "@v3/xmp/components/website/nav-visual-editor";
import { SiteFooter, SiteHeader } from "@v3/ui/components/public/site-chrome";
import {
  NAV_SITES,
  loadNavMenus,
  navLinkCount,
  navMutations,
  normalizeFooter,
  normalizeHeader,
  siteLabel,
  type NavMenu,
  type NavMenuType,
} from "@v3/ui/lib/nav-menus";
import { useRole } from "@v3/ui/lib/roles";

function pretty(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

export function NavManager() {
  const qc = useQueryClient();
  const role = useRole();
  const canEdit = role?.canEdit !== false;

  const { data: menus = [], isLoading } = useQuery({ queryKey: ["nav-menus"], queryFn: loadNavMenus });

  const [editing, setEditing] = useState<NavMenu | null>(null);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [itemsText, setItemsText] = useState("{}");
  const [mode, setMode] = useState<"visual" | "code">("visual");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<NavMenuType>("header");
  const [copyFrom, setCopyFrom] = useState<string>("blank");

  useEffect(() => {
    if (!editing) return;
    setName(editing.name);
    setNotes(editing.notes ?? "");
    setItemsText(pretty(editing.items));
  }, [editing]);

  const parsed = useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(itemsText) as unknown };
    } catch (error) {
      return { ok: false as const, message: (error as Error).message };
    }
  }, [itemsText]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["nav-menus"] });
    void qc.invalidateQueries({ queryKey: ["nav-menus-trash"] });
    void qc.invalidateQueries({ queryKey: ["assigned-nav"] });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      if (!parsed.ok) throw new Error("The links JSON isn't valid yet.");
      await navMutations.update(editing.id, {
        name: name.trim() || editing.name,
        notes: notes.trim() || null,
        items: parsed.value as never,
      });
      await role?.logAudit("nav_menu_update", editing.id, { name: name.trim() });
    },
    onSuccess: () => {
      toast.success("Navigation saved");
      invalidate();
      setEditing(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const assign = useMutation({
    mutationFn: async ({ menu, site }: { menu: NavMenu; site: string | null }) => {
      await navMutations.setAssignment(menu.id, menu.menu_type, site);
      await role?.logAudit("nav_menu_assign", menu.id, { site });
    },
    onSuccess: () => {
      toast.success("Assignment updated");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const duplicate = useMutation({
    mutationFn: async (menu: NavMenu) => {
      const id = await navMutations.duplicate(menu.id);
      await role?.logAudit("nav_menu_duplicate", id, { source: menu.id });
    },
    onSuccess: () => {
      toast.success("Copy created (unassigned)");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: async (menu: NavMenu) => {
      await navMutations.softDelete(menu.id, role?.user?.id ?? null);
      await role?.logAudit("nav_menu_delete", menu.id, { name: menu.name });
    },
    onSuccess: () => {
      toast.success("Moved to Trash");
      invalidate();
      setEditing(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!newName.trim()) throw new Error("Give the navigation a name.");
      if (copyFrom !== "blank") {
        const source = menus.find((m) => m.id === copyFrom);
        if (!source) throw new Error("Pick a navigation to copy.");
        const id = await navMutations.create({
          name: newName.trim(),
          menu_type: source.menu_type,
          items: source.items,
        });
        await role?.logAudit("nav_menu_create", id, { from: source.id });
        return;
      }
      const id = await navMutations.create({ name: newName.trim(), menu_type: newType });
      await role?.logAudit("nav_menu_create", id, { menu_type: newType });
    },
    onSuccess: () => {
      toast.success("Navigation created");
      invalidate();
      setCreating(false);
      setNewName("");
      setCopyFrom("blank");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const headers = menus.filter((m) => m.menu_type === "header");
  const footers = menus.filter((m) => m.menu_type === "footer");

  const previewHeader = editing?.menu_type === "header" && parsed.ok ? normalizeHeader(parsed.value) : null;
  const previewFooter = editing?.menu_type === "footer" && parsed.ok ? normalizeFooter(parsed.value) : null;

  const table = (rows: NavMenu[], title: string, description: string) => (
    <Panel title={title} description={description}>
      <DataTable
        rows={rows}
        loading={isLoading}
        getRowKey={(row) => row.id}
        onRowClick={(row) => setEditing(row)}
        empty={
          <EmptyState
            icon={<Link2 className="h-5 w-5" />}
            title="No navigation yet"
            description="Create one to manage these links from the CMS."
          />
        }
        columns={[
          { key: "name", header: "Name", cell: (row) => <span className="font-medium">{row.name}</span> },
          {
            key: "assignment",
            header: "Assignment",
            cell: (row) =>
              row.assigned_site ? (
                <Pill value={siteLabel(row.assigned_site)} className="bg-emerald-50 text-emerald-700" />
              ) : (
                <Pill value="Unassigned" />
              ),
          },
          { key: "links", header: "Links", cell: (row) => navLinkCount(row) },
          {
            key: "updated",
            header: "Updated",
            cell: (row) => (row.updated_at ? new Date(row.updated_at).toLocaleDateString() : "—"),
          },
          {
            key: "actions",
            header: "",
            cell: (row) => (
              <div className="flex items-center justify-end gap-2" onClick={(event) => event.stopPropagation()}>
                <Select
                  value={row.assigned_site ?? "none"}
                  onValueChange={(value) =>
                    assign.mutate({ menu: row, site: value === "none" ? null : value })
                  }
                  disabled={!canEdit}
                >
                  <SelectTrigger className="h-8 w-[170px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {NAV_SITES.map((site) => (
                      <SelectItem key={site.key} value={site.key}>
                        {site.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="sm" onClick={() => duplicate.mutate(row)} disabled={!canEdit}>
                  <CopyPlus className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remove.mutate(row)}
                  disabled={!canEdit || !!row.assigned_site}
                  title={row.assigned_site ? "Unassign before deleting" : "Move to Trash"}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ),
          },
        ]}
      />
    </Panel>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          The assigned top nav and footer are what the main website renders. Unassigned navigations are
          drafts you can hand to a microsite later.
        </p>
        <Button onClick={() => setCreating(true)} disabled={!canEdit} className="gap-1.5">
          <Plus className="h-4 w-4" /> New navigation
        </Button>
      </div>

      {table(headers, "Top nav", "One header can be assigned per site.")}
      {table(footers, "Footer", "One footer can be assigned per site.")}

      <DetailDrawer
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing?.name ?? "Navigation"}
        description={
          editing
            ? `${editing.menu_type === "header" ? "Top nav" : "Footer"} · ${siteLabel(editing.assigned_site)}`
            : undefined
        }
        aside={
          editing ? (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preview</p>
              {parsed.ok ? (
                <div className="overflow-hidden rounded-xl border bg-white">
                  <div className="scale-[0.82] origin-top">
                    {previewHeader ? <SiteHeader data={previewHeader} /> : null}
                    {previewFooter ? <SiteFooter data={previewFooter} /> : null}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-destructive">Fix the JSON to see the preview.</p>
              )}
            </div>
          ) : undefined
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>
              Close
            </Button>
            <Button onClick={() => save.mutate()} disabled={!canEdit || !parsed.ok || save.isPending}>
              Save
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <FieldRow label="Name">
            <Input value={name} onChange={(event) => setName(event.target.value)} disabled={!canEdit} />
          </FieldRow>
          <FieldRow label="Notes">
            <Input value={notes} onChange={(event) => setNotes(event.target.value)} disabled={!canEdit} />
          </FieldRow>
          <FieldRow label="Assignment">
            <Select
              value={editing?.assigned_site ?? "none"}
              onValueChange={(value) =>
                editing && assign.mutate({ menu: editing, site: value === "none" ? null : value })
              }
              disabled={!canEdit}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {NAV_SITES.map((site) => (
                  <SelectItem key={site.key} value={site.key}>
                    {site.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Links
            </p>
            <Tabs value={mode} onValueChange={(value) => setMode(value as "visual" | "code")}>
              <TabsList className="mb-3">
                <TabsTrigger value="visual">Simple editor</TabsTrigger>
                <TabsTrigger value="code">Code</TabsTrigger>
              </TabsList>
              <TabsContent value="visual">
                {parsed.ok && editing ? (
                  <NavVisualEditor
                    menuType={editing.menu_type}
                    value={parsed.value}
                    disabled={!canEdit}
                    onChange={(next) => setItemsText(JSON.stringify(next, null, 2))}
                  />
                ) : (
                  <p className="rounded-lg border border-dashed p-4 text-sm text-destructive">
                    The code below has an error, so the simple editor is paused. Fix it on the Code
                    tab to continue.
                  </p>
                )}
              </TabsContent>
              <TabsContent value="code">
                <p className="mb-2 text-xs text-muted-foreground">
                  {editing?.menu_type === "header"
                    ? 'Shape: { "groups": [{ "kind": "menu" | "link", "label", "href", "wide", "items": [{ "label", "href", "blurb" }] }], "actions": [{ "label", "href", "style": "primary" | "text" }] }'
                    : 'Shape: { "blurb": "…", "columns": [{ "title", "links": [{ "label", "href" }] }] }'}
                </p>
                <Textarea
                  value={itemsText}
                  onChange={(event) => setItemsText(event.target.value)}
                  rows={22}
                  spellCheck={false}
                  className="font-mono text-xs"
                  disabled={!canEdit}
                />
                {!parsed.ok ? (
                  <p className="mt-1 text-xs text-destructive">{parsed.message}</p>
                ) : null}
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </DetailDrawer>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New navigation</DialogTitle>
            <DialogDescription>
              Start empty or copy an existing navigation. New navigations start unassigned.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <FieldRow label="Name">
              <Input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Microsite top nav"
              />
            </FieldRow>
            <FieldRow label="Start from">
              <Select value={copyFrom} onValueChange={setCopyFrom}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="blank">Blank</SelectItem>
                  {menus.map((menu) => (
                    <SelectItem key={menu.id} value={menu.id}>
                      Copy of {menu.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
            {copyFrom === "blank" ? (
              <FieldRow label="Type">
                <Select value={newType} onValueChange={(value) => setNewType(value as NavMenuType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="header">Top nav</SelectItem>
                    <SelectItem value="footer">Footer</SelectItem>
                  </SelectContent>
                </Select>
              </FieldRow>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
