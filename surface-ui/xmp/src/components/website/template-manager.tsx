import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyPlus, Eye, FilePlus2, LayoutTemplate, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@v3/ui/components/ui/button";
import { Checkbox } from "@v3/ui/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@v3/ui/components/ui/dialog";
import { Input } from "@v3/ui/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@v3/xmp/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@v3/ui/components/ui/select";
import { DataTable, EmptyState, Panel } from "@v3/ui/components/console/primitives";
import { FieldRow, Pill } from "@v3/ui/components/website/bits";
import { blocksOf, type Block } from "@v3/ui/lib/public-site";
import {
  DESIGN_TAG_LABEL,
  PAGE_TYPES,
  loadPageTemplates,
  webMutations,
  type WebPage,
  type WebPageTemplate,
} from "@v3/xmp/lib/website";
import { useRole } from "@v3/ui/lib/roles";

function blockLabel(block: Block, index: number) {
  return block.headline || block.eyebrow || block.items?.[0]?.title || `${String(block.type).replaceAll("_", " ")} section ${index + 1}`;
}

function settingsOf(page: WebPage) {
  return {
    page_type: page.page_type,
    seo_title: page.seo_title,
    seo_desc: page.seo_desc,
    design_tag: page.design_tag,
  };
}

export function TemplateManager({ pages, createSource, onCreateClosed, focusTemplateId }: {
  pages: WebPage[];
  createSource: WebPage | null;
  onCreateClosed: () => void;
  /** Template highlighted when arriving from a page's "Edit template" action. */
  focusTemplateId?: string | null;
}) {
  const qc = useQueryClient();
  const role = useRole();
  const { data: templates = [], isLoading } = useQuery({ queryKey: ["web-page-templates"], queryFn: loadPageTemplates });
  const [kind, setKind] = useState<"page" | "section">("page");
  const [name, setName] = useState("");
  const [sectionIndexes, setSectionIndexes] = useState<number[]>([]);
  const [using, setUsing] = useState<WebPageTemplate | null>(null);
  const [previewing, setPreviewing] = useState<WebPageTemplate | null>(null);
  const [renaming, setRenaming] = useState<WebPageTemplate | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [useMode, setUseMode] = useState<"new" | "existing">("new");
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState("landing");
  const [destinationId, setDestinationId] = useState("");

  const sourceBlocks = useMemo(() => blocksOf(createSource?.body), [createSource]);

  useEffect(() => {
    if (!createSource) return;
    setName(`${createSource.title ?? "Untitled"} template`);
    setKind("page");
    setSectionIndexes([]);
  }, [createSource]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["web-page-templates"] });
    qc.invalidateQueries({ queryKey: ["web-page-templates-trash"] });
  };
  const refreshPages = () => qc.invalidateQueries({ queryKey: ["web-pages"] });

  const create = useMutation({
    mutationFn: async () => {
      if (!createSource) throw new Error("Select a source page");
      if (!name.trim()) throw new Error("Enter a template name");
      if (kind === "section" && sectionIndexes.length === 0) throw new Error("Select at least one section");
      const body = kind === "page" ? sourceBlocks : sourceBlocks.filter((_, index) => sectionIndexes.includes(index));
      return webMutations.createPageTemplate({
        name: name.trim(),
        template_kind: kind,
        source_page_id: createSource.id,
        source_page_title: createSource.title ?? "Untitled",
        body: body as never,
        page_settings: settingsOf(createSource) as never,
        section_indexes: kind === "section" ? sectionIndexes : sourceBlocks.map((_, index) => index),
        design_tag: createSource.design_tag === "old_design" ? "old_design" : "new",
        created_by: role.user?.id ?? "",
        created_by_label: role.user?.email ?? role.activeRole,
      });
    },
    onSuccess: async (template) => {
      await role.logAudit("cms_template_create", template.id, { kind: template.template_kind, source_page_id: template.source_page_id });
      toast.success("Template saved");
      refresh();
      onCreateClosed();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const useTemplate = useMutation({
    mutationFn: async () => {
      if (!using) throw new Error("Choose a template");
      const settings = (using.page_settings ?? {}) as Record<string, unknown>;
      if (useMode === "new") {
        if (!newTitle.trim()) throw new Error("Enter a page title");
        return webMutations.createPageFromTemplate({
          title: newTitle.trim(), page_type: newType, body: using.body, settings, updated_by: role.user?.email,
        });
      }
      const destination = pages.find((page) => page.id === destinationId);
      if (!destination) throw new Error("Choose a destination page");
      if (using.template_kind === "page") {
        await webMutations.applyPageTemplate(destination.id, using.body, settings, role.user?.email);
      } else {
        await webMutations.appendSectionTemplate(destination, using.body, role.user?.email);
      }
      return destination;
    },
    onSuccess: async (page) => {
      if (using) await role.logAudit("cms_template_apply", using.id, { mode: useMode, page_id: page.id, kind: using.template_kind });
      toast.success(useMode === "new" ? "Draft created from template" : "Template applied to page");
      setUsing(null);
      setNewTitle("");
      setDestinationId("");
      refreshPages();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rename = useMutation({
    mutationFn: async () => {
      if (!renaming || !renameValue.trim()) throw new Error("Enter a template name");
      await webMutations.renamePageTemplate(renaming.id, renameValue.trim());
      return renaming;
    },
    onSuccess: async (template) => {
      await role.logAudit("cms_template_rename", template.id, { name: renameValue.trim() });
      toast.success("Template renamed");
      setRenaming(null);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (template: WebPageTemplate) => webMutations.deletePageTemplate(template.id).then(() => template),
    onSuccess: async (template) => {
      await role.logAudit("cms_template_delete", template.id, { name: template.name });
      toast.success("Template deleted");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <Panel
        title="Templates"
        description={
          focusTemplateId
            ? `Showing “${templates.find((t) => t.id === focusTemplateId)?.name ?? "the template"}” first — the template that page follows.`
            : "Reusable whole pages and selected sections captured from Site Content."
        }
        bodyClassName="px-3 py-2"
      >
        <DataTable
          columns={[
            { key: "name", header: "Template", cell: (t) => <div><div className="font-medium text-ink">{t.name}</div><div className="text-xs text-[color:var(--color-ink-3)]">From {t.source_page_title ?? "deleted page"}</div></div> },
            { key: "kind", header: "Type", cell: (t) => <Pill value={t.template_kind === "page" ? "Whole page" : "Section"} /> },
            { key: "sections", header: "Sections", cell: (t) => blocksOf(t.body).length },
            { key: "pages", header: "Pages using", cell: (t) => pages.filter((page) => page.template_id === t.id).length },
            { key: "design", header: "Design", cell: (t) => DESIGN_TAG_LABEL[t.design_tag] ?? t.design_tag },
            { key: "creator", header: "Created by", cell: (t) => <span className="text-xs text-[color:var(--color-ink-2)]">{t.created_by_label ?? "—"}</span> },
            { key: "updated", header: "Updated", cell: (t) => <span className="text-xs text-[color:var(--color-ink-2)]">{new Date(t.updated_at).toLocaleString()}</span> },
            { key: "actions", header: "", align: "right", cell: (t) => <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              <Button size="icon" variant="ghost" className="h-8 w-8" title="Preview contents" onClick={() => setPreviewing(t)}><Eye className="h-4 w-4" /></Button>
              {role.canEdit ? <><Button size="sm" variant="outline" className="gap-1" onClick={() => { setUsing(t); setUseMode("new"); setNewType(String(((t.page_settings ?? {}) as Record<string, unknown>).page_type ?? "landing")); }}><CopyPlus className="h-3.5 w-3.5" /> Use</Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" title="Rename" onClick={() => { setRenaming(t); setRenameValue(t.name); }}><Pencil className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" title="Delete" onClick={() => confirm(`Delete “${t.name}”?`) && remove.mutate(t)}><Trash2 className="h-4 w-4" /></Button></> : null}
            </div> },
          ]}
          rows={focusTemplateId ? [...templates].sort((a, b) => (a.id === focusTemplateId ? -1 : b.id === focusTemplateId ? 1 : 0)) : templates}
          getRowKey={(t) => t.id}
          loading={isLoading}
          empty={<EmptyState icon={<LayoutTemplate className="h-4 w-4" />} title="No templates yet" description="Select one page in Pages, then choose Create template." compact />}
        />
      </Panel>

      <Dialog open={!!createSource} onOpenChange={(open) => !open && onCreateClosed()}>
        <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>Create template</DialogTitle><DialogDescription>Capture {createSource?.title ?? "this page"} as a reusable snapshot.</DialogDescription></DialogHeader>
          <FieldRow label="Template name"><Input value={name} onChange={(e) => setName(e.target.value)} /></FieldRow>
          <RadioGroup value={kind} onValueChange={(value) => setKind(value as "page" | "section")} className="grid gap-3 sm:grid-cols-2">
            <label className="flex cursor-pointer gap-3 rounded-md border border-border p-4"><RadioGroupItem value="page" /><span><span className="block text-sm font-semibold">Whole page</span><span className="text-xs text-muted-foreground">Save every section and page setting.</span></span></label>
            <label className="flex cursor-pointer gap-3 rounded-md border border-border p-4"><RadioGroupItem value="section" /><span><span className="block text-sm font-semibold">Specific sections</span><span className="text-xs text-muted-foreground">Choose one or more sections below.</span></span></label>
          </RadioGroup>
          {kind === "section" ? <div className="space-y-2"><p className="text-sm font-semibold">Which sections?</p>{sourceBlocks.length ? sourceBlocks.map((block, index) => <label key={index} className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 hover:bg-muted/50"><Checkbox checked={sectionIndexes.includes(index)} onCheckedChange={(checked) => setSectionIndexes((current) => checked ? [...current, index].sort((a,b) => a-b) : current.filter((value) => value !== index))} /><span><span className="block text-sm font-medium">{blockLabel(block, index)}</span><span className="text-xs capitalize text-muted-foreground">{String(block.type).replaceAll("_", " ")} · Section {index + 1}</span></span></label>) : <EmptyState title="No editable sections" description="This page has no CMS blocks to capture." compact />}</div> : null}
          <DialogFooter><Button variant="outline" onClick={onCreateClosed}>Cancel</Button><Button disabled={!role.canEdit || create.isPending} onClick={() => create.mutate()}>Save template</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!using} onOpenChange={(open) => !open && setUsing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Use {using?.name}</DialogTitle><DialogDescription>Create a new draft or apply this saved content to a page.</DialogDescription></DialogHeader>
          <RadioGroup value={useMode} onValueChange={(value) => setUseMode(value as "new" | "existing")} className="grid grid-cols-2 gap-3">
            <label className="flex cursor-pointer gap-2 rounded-md border border-border p-3"><RadioGroupItem value="new" /> <span className="text-sm font-medium">Create new draft</span></label>
            <label className="flex cursor-pointer gap-2 rounded-md border border-border p-3"><RadioGroupItem value="existing" /> <span className="text-sm font-medium">Apply to page</span></label>
          </RadioGroup>
          {useMode === "new" ? <div className="grid gap-4 sm:grid-cols-2"><FieldRow label="Page title"><Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} /></FieldRow><FieldRow label="Page type"><Select value={newType} onValueChange={setNewType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PAGE_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent></Select></FieldRow></div> : <FieldRow label="Destination page"><Select value={destinationId} onValueChange={setDestinationId}><SelectTrigger><SelectValue placeholder="Choose a page" /></SelectTrigger><SelectContent>{pages.map((page) => <SelectItem key={page.id} value={page.id}>{page.title ?? "Untitled"}</SelectItem>)}</SelectContent></Select><p className="mt-2 text-xs text-muted-foreground">{using?.template_kind === "page" ? "This replaces the destination page content after confirmation." : "Selected sections will be appended to the destination page."}</p></FieldRow>}
          <DialogFooter><Button variant="outline" onClick={() => setUsing(null)}>Cancel</Button><Button disabled={useTemplate.isPending} onClick={() => { if (useMode === "existing" && using?.template_kind === "page" && !confirm("Replace the destination page content with this template?")) return; useTemplate.mutate(); }}>{useMode === "new" ? <FilePlus2 className="mr-1.5 h-4 w-4" /> : null}{useMode === "new" ? "Create draft" : "Apply template"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!previewing} onOpenChange={(open) => !open && setPreviewing(null)}><DialogContent className="max-h-[80vh] overflow-y-auto"><DialogHeader><DialogTitle>{previewing?.name}</DialogTitle><DialogDescription>{blocksOf(previewing?.body).length} saved section(s), in order.</DialogDescription></DialogHeader><div className="space-y-2">{blocksOf(previewing?.body).map((block, index) => <div key={index} className="rounded-md border border-border p-3"><p className="text-sm font-medium">{blockLabel(block, index)}</p><p className="text-xs capitalize text-muted-foreground">{String(block.type).replaceAll("_", " ")}</p></div>)}</div></DialogContent></Dialog>

      <Dialog open={!!renaming} onOpenChange={(open) => !open && setRenaming(null)}><DialogContent><DialogHeader><DialogTitle>Rename template</DialogTitle></DialogHeader><Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} /><DialogFooter><Button variant="outline" onClick={() => setRenaming(null)}>Cancel</Button><Button disabled={rename.isPending} onClick={() => rename.mutate()}>Save name</Button></DialogFooter></DialogContent></Dialog>
    </>
  );
}