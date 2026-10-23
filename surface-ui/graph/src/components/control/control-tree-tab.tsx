import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  CreditCard,
  Link2,
  Pencil,
  Plus,
  Archive,
  MoveRight,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@v3/ui/integrations/supabase/client";
import { Button } from "@v3/ui/components/ui/button";
import { Input } from "@v3/ui/components/ui/input";
import { Label } from "@v3/ui/components/ui/label";
import { Badge } from "@v3/ui/components/ui/badge";
import { Switch } from "@v3/ui/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@v3/ui/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@v3/ui/components/ui/tooltip";
import { ReadOnlyLock } from "@v3/ui/components/model-lock";
import { useRole } from "@v3/ui/lib/roles";
import { cn } from "@v3/ui/lib/utils";

type ControlNode = {
  node_id: string;
  name: string;
  node_type: string;
  parent_id: string | null;
  is_billing_container: boolean;
  linked_entity_id: string | null;
  status: string;
  created_at: string;
};

type BrandEntity = {
  entity_id: string;
  display_name: string;
  entity_type: string;
};

function rpcMessage(err: unknown): string {
  const e = err as { message?: string; hint?: string; details?: string } | null;
  return e?.message || e?.details || "The change was rejected.";
}

/** Searchable dropdown over brand entities. */
function BrandPicker({
  value,
  onChange,
  brands,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  brands: BrandEntity[];
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = brands.find((b) => b.entity_id === value) ?? null;
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? brands.filter((b) => b.display_name.toLowerCase().includes(needle))
      : brands;
    return list.slice(0, 50);
  }, [brands, q]);

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Linked brand entity (optional)</Label>
      <div className="rounded-md border border-slate-200">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
        >
          <span className={selected ? "text-slate-900" : "text-slate-400"}>
            {selected ? selected.display_name : "None"}
          </span>
          <ChevronDown className="h-4 w-4 text-slate-400" />
        </button>
        {open && (
          <div className="border-t border-slate-200 p-2">
            <div className="relative mb-2">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search brands…"
                className="h-8 pl-7 text-xs"
              />
            </div>
            <div className="max-h-48 space-y-0.5 overflow-auto">
              <button
                type="button"
                className="w-full rounded px-2 py-1.5 text-left text-xs text-slate-500 hover:bg-slate-50"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                None
              </button>
              {filtered.length === 0 ? (
                <div className="px-2 py-2 text-xs text-slate-400">No brand entities found.</div>
              ) : (
                filtered.map((b) => (
                  <button
                    key={b.entity_id}
                    type="button"
                    className={cn(
                      "w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-50",
                      b.entity_id === value && "bg-slate-50 font-medium",
                    )}
                    onClick={() => {
                      onChange(b.entity_id);
                      setOpen(false);
                    }}
                  >
                    {b.display_name}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ControlTreeTab() {
  const { canEdit } = useRole();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showArchived, setShowArchived] = useState(false);

  const [nodeDialog, setNodeDialog] = useState<
    | null
    | {
        mode: "create";
        parentId: string | null;
        name: string;
        nodeType: string;
        billing: boolean;
        linked: string | null;
      }
    | {
        mode: "edit";
        nodeId: string;
        name: string;
        nodeType: string;
        billing: boolean;
        linked: string | null;
      }
  >(null);
  const [moveTarget, setMoveTarget] = useState<ControlNode | null>(null);
  const [movePick, setMovePick] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ControlNode | null>(null);

  const { data: nodes, isLoading } = useQuery({
    queryKey: ["exp_control_nodes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exp_control_nodes")
        .select("node_id, name, node_type, parent_id, is_billing_container, linked_entity_id, status, created_at")
        .order("name");
      if (error) throw error;
      return (data ?? []) as ControlNode[];
    },
  });

  const { data: brands } = useQuery({
    queryKey: ["exp_entity", "brands"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exp_entity")
        .select("entity_id, display_name, entity_type")
        .eq("entity_type", "brand")
        .not("status", "in", "(merged,deactivated)")
        .order("display_name")
        .limit(500);
      if (error) throw error;
      return (data ?? []) as BrandEntity[];
    },
  });

  const rows = nodes ?? [];
  const visible = showArchived ? rows : rows.filter((n) => n.status !== "archived");
  const brandName = (id: string | null) =>
    (brands ?? []).find((b) => b.entity_id === id)?.display_name ?? null;

  const childrenOf = useMemo(() => {
    const map = new Map<string, ControlNode[]>();
    visible.forEach((n) => {
      const key = n.parent_id ?? "__root__";
      const arr = map.get(key) ?? [];
      arr.push(n);
      map.set(key, arr);
    });
    return map;
  }, [visible]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["exp_control_nodes"] });
    void queryClient.invalidateQueries({ queryKey: ["exp_validate_graph"] });
  };

  const createNode = useMutation({
    mutationFn: async (v: {
      name: string;
      nodeType: string;
      parentId: string | null;
      billing: boolean;
      linked: string | null;
    }) => {
      const { error } = await supabase.rpc("exp_ctrl_create_node", {
        p_name: v.name,
        p_node_type: v.nodeType,
        p_parent: v.parentId ?? undefined,
        p_billing: v.billing,
        p_linked_entity: v.linked ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Node created");
      setNodeDialog(null);
      invalidate();
    },
    onError: (e) => toast.error(rpcMessage(e)),
  });

  const updateNode = useMutation({
    mutationFn: async (v: {
      nodeId: string;
      name?: string;
      nodeType?: string;
      billing?: boolean;
      linked?: string | null;
      parentId?: string | null;
      move?: boolean;
      status?: string;
    }) => {
      const { error } = await supabase.rpc("exp_ctrl_update_node", {
        p_id: v.nodeId,
        ...(v.name !== undefined ? { p_name: v.name } : {}),
        ...(v.nodeType !== undefined ? { p_node_type: v.nodeType } : {}),
        ...(v.billing !== undefined ? { p_billing: v.billing } : {}),
        ...(v.linked !== undefined ? { p_linked_entity: v.linked ?? undefined } : {}),
        ...(v.move ? { p_move: true, p_parent: v.parentId ?? undefined } : {}),
        ...(v.status !== undefined ? { p_status: v.status } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Node updated");
      setNodeDialog(null);
      setMoveTarget(null);
      setArchiveTarget(null);
      invalidate();
    },
    onError: (e) => toast.error(rpcMessage(e)),
  });

  function renderNode(node: ControlNode, depth: number) {
    const kids = childrenOf.get(node.node_id) ?? [];
    const isOpen = expanded[node.node_id] ?? depth < 1;
    const linked = brandName(node.linked_entity_id);
    return (
      <div key={node.node_id}>
        <div
          className="group flex items-center gap-2 rounded-md px-2 py-2 hover:bg-slate-50"
          style={{ paddingLeft: 8 + depth * 20 }}
        >
          {kids.length > 0 ? (
            <button
              type="button"
              onClick={() => setExpanded((s) => ({ ...s, [node.node_id]: !isOpen }))}
              className="grid h-5 w-5 place-items-center rounded text-slate-400 hover:bg-slate-100"
              aria-label={isOpen ? "Collapse" : "Expand"}
            >
              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          ) : (
            <span className="h-5 w-5" />
          )}

          <span
            className={cn(
              "text-sm font-medium",
              node.status === "archived" ? "text-slate-400 line-through" : "text-slate-900",
            )}
          >
            {node.name}
          </span>

          <Badge
            variant="secondary"
            className="bg-slate-100 text-slate-600 font-normal capitalize"
          >
            {node.node_type}
          </Badge>

          {node.is_billing_container && (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-slate-400">
                    <CreditCard className="h-3.5 w-3.5" />
                  </span>
                </TooltipTrigger>
                <TooltipContent className="text-xs">Billing container</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {node.linked_entity_id && (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-slate-400">
                    <Link2 className="h-3.5 w-3.5" />
                  </span>
                </TooltipTrigger>
                <TooltipContent className="text-xs">
                  Linked brand entity{linked ? `: ${linked}` : ""}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {node.status === "archived" && (
            <Badge variant="secondary" className="bg-amber-50 text-amber-700 font-normal">
              archived
            </Badge>
          )}

          {canEdit && (
            <div className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() =>
                  setNodeDialog({
                    mode: "create",
                    parentId: node.node_id,
                    name: "",
                    nodeType: "",
                    billing: false,
                    linked: null,
                  })
                }
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Child
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() =>
                  setNodeDialog({
                    mode: "edit",
                    nodeId: node.node_id,
                    name: node.name,
                    nodeType: node.node_type,
                    billing: node.is_billing_container,
                    linked: node.linked_entity_id,
                  })
                }
              >
                <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  setMoveTarget(node);
                  setMovePick(node.parent_id);
                }}
              >
                <MoveRight className="mr-1 h-3.5 w-3.5" /> Move
              </Button>
              {node.status !== "archived" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-slate-500"
                  onClick={() => setArchiveTarget(node)}
                >
                  <Archive className="mr-1 h-3.5 w-3.5" /> Archive
                </Button>
              )}
            </div>
          )}
        </div>
        {isOpen && kids.map((k) => renderNode(k, depth + 1))}
      </div>
    );
  }

  // Descendants of the move target may not be chosen as its new parent.
  const invalidParents = useMemo(() => {
    if (!moveTarget) return new Set<string>();
    const out = new Set<string>([moveTarget.node_id]);
    const walk = (id: string) => {
      (childrenOf.get(id) ?? []).forEach((c) => {
        out.add(c.node_id);
        walk(c.node_id);
      });
    };
    walk(moveTarget.node_id);
    return out;
  }, [moveTarget, childrenOf]);

  function renderPicker(node: ControlNode, depth: number) {
    const disabled = invalidParents.has(node.node_id);
    const kids = childrenOf.get(node.node_id) ?? [];
    return (
      <div key={node.node_id}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setMovePick(node.node_id)}
          className={cn(
            "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs",
            disabled ? "cursor-not-allowed text-slate-300" : "hover:bg-slate-50",
            movePick === node.node_id && "bg-[color:var(--color-g-blue-soft)] font-semibold",
          )}
          style={{ paddingLeft: 8 + depth * 16 }}
        >
          {node.name}
          <span className="text-slate-400">· {node.node_type}</span>
        </button>
        {kids.map((k) => renderPicker(k, depth + 1))}
      </div>
    );
  }

  const roots = childrenOf.get("__root__") ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <Switch checked={showArchived} onCheckedChange={setShowArchived} />
          Show archived
        </label>
        {canEdit ? (
          <Button
            size="sm"
            onClick={() =>
              setNodeDialog({
                mode: "create",
                parentId: null,
                name: "",
                nodeType: "",
                billing: false,
                linked: null,
              })
            }
          >
            <Plus className="mr-1.5 h-4 w-4" /> Add root node
          </Button>
        ) : (
          <ReadOnlyLock />
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-2">
        {isLoading ? (
          <div className="p-6 text-sm text-slate-500">Loading control tree…</div>
        ) : roots.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-sm font-medium text-slate-900">No control nodes yet</div>
            <p className="mt-1 text-xs text-slate-500">
              Add a root node to start the hierarchy — enterprises, regions and divisions nest below it.
            </p>
          </div>
        ) : (
          roots.map((n) => renderNode(n, 0))
        )}
      </div>

      {/* Create / edit dialog */}
      <Dialog open={!!nodeDialog} onOpenChange={(o) => !o && setNodeDialog(null)}>
        <DialogContent className="sm:max-w-md">
          {nodeDialog && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {nodeDialog.mode === "create"
                    ? nodeDialog.parentId
                      ? "Add child node"
                      : "Add root node"
                    : "Edit node"}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Changes are applied through governed control-graph functions.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Name</Label>
                  <Input
                    value={nodeDialog.name}
                    onChange={(e) => setNodeDialog({ ...nodeDialog, name: e.target.value })}
                    placeholder="e.g. West Region"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Node type</Label>
                  <Input
                    value={nodeDialog.nodeType}
                    onChange={(e) => setNodeDialog({ ...nodeDialog, nodeType: e.target.value })}
                    placeholder="e.g. Enterprise, Region, Division"
                  />
                </div>
                <label className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
                  <span className="text-xs text-slate-700">Billing container</span>
                  <Switch
                    checked={nodeDialog.billing}
                    onCheckedChange={(v) => setNodeDialog({ ...nodeDialog, billing: v })}
                  />
                </label>
                <BrandPicker
                  value={nodeDialog.linked}
                  brands={brands ?? []}
                  onChange={(id) => setNodeDialog({ ...nodeDialog, linked: id })}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setNodeDialog(null)}>
                  Cancel
                </Button>
                <Button
                  disabled={
                    !nodeDialog.name.trim() ||
                    !nodeDialog.nodeType.trim() ||
                    createNode.isPending ||
                    updateNode.isPending
                  }
                  onClick={() => {
                    if (nodeDialog.mode === "create") {
                      createNode.mutate({
                        name: nodeDialog.name.trim(),
                        nodeType: nodeDialog.nodeType.trim(),
                        parentId: nodeDialog.parentId,
                        billing: nodeDialog.billing,
                        linked: nodeDialog.linked,
                      });
                    } else {
                      updateNode.mutate({
                        nodeId: nodeDialog.nodeId,
                        name: nodeDialog.name.trim(),
                        nodeType: nodeDialog.nodeType.trim(),
                        billing: nodeDialog.billing,
                        linked: nodeDialog.linked,
                      });
                    }
                  }}
                >
                  {nodeDialog.mode === "create" ? "Create node" : "Save changes"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Move dialog */}
      <Dialog open={!!moveTarget} onOpenChange={(o) => !o && setMoveTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move “{moveTarget?.name}”</DialogTitle>
            <DialogDescription className="text-xs">
              Pick the new parent. Cycles are rejected by the control graph.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 overflow-auto rounded-md border border-slate-200 p-1">
            <button
              type="button"
              onClick={() => setMovePick(null)}
              className={cn(
                "w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-50",
                movePick === null && "bg-[color:var(--color-g-blue-soft)] font-semibold",
              )}
            >
              Root level (no parent)
            </button>
            {roots.map((n) => renderPicker(n, 0))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveTarget(null)}>
              Cancel
            </Button>
            <Button
              disabled={updateNode.isPending}
              onClick={() =>
                moveTarget &&
                updateNode.mutate({ nodeId: moveTarget.node_id, move: true, parentId: movePick })
              }
            >
              Move node
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive dialog */}
      <Dialog open={!!archiveTarget} onOpenChange={(o) => !o && setArchiveTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Archive “{archiveTarget?.name}”?</DialogTitle>
            <DialogDescription className="text-xs">
              The node stays in the graph with status “archived”.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveTarget(null)}>
              Cancel
            </Button>
            <Button
              disabled={updateNode.isPending}
              onClick={() =>
                archiveTarget &&
                updateNode.mutate({ nodeId: archiveTarget.node_id, status: "archived" })
              }
            >
              Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
