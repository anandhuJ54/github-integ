import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  Copy,
  ExternalLink,
  FileText,
  LayoutTemplate,
  Link2,
  Eye,
  Pencil,
  Plus,
  RotateCcw,
  Shapes,
  Trash2,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@v3/ui/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@v3/ui/components/ui/dropdown-menu";
import { toast } from "sonner";
import { Button } from "@v3/ui/components/ui/button";
import { Input } from "@v3/ui/components/ui/input";
import { Textarea } from "@v3/ui/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@v3/ui/components/ui/select";
import {
  DataTable,
  DetailDrawer,
  EmptyState,
  PageBody,
  PageHeader,
  Panel,
  StatTile,
} from "@v3/ui/components/console/primitives";
import { FieldRow, Pill } from "@v3/ui/components/website/bits";
import { SectionEditor } from "@v3/marketing/components/website/section-editor";
import { TemplateManager } from "@v3/marketing/components/website/template-manager";
import { NavManager } from "@v3/marketing/components/website/nav-manager";
import { loadDeletedNavMenus, navMutations, siteLabel, type NavMenu } from "@v3/ui/lib/nav-menus";
import { PagePreview } from "@v3/marketing/components/website/page-preview";
import { Checkbox } from "@v3/ui/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@v3/ui/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@v3/marketing/components/ui/radio-group";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@v3/ui/components/ui/tabs";
import { blocksOf, type Block } from "@v3/ui/lib/public-site";
import {
  DESIGN_TAGS,
  DESIGN_TAG_LABEL,
  PAGE_TYPES,
  publicPathForPage,
  loadDeletedPageTemplates,
  loadDeletedPages,
  loadPageTemplates,
  loadPages,
  slugify,
  webMutations,
  type DesignTag,
  type PageType,
  type WebPage,
  type WebPageTemplate,
} from "@v3/marketing/lib/website";
import { useOptionalRole } from "@v3/ui/lib/roles";

type CmsSection = "pages" | "templates" | "navigation" | "trash";

export const Route = createFileRoute("/_authenticated/website/cms")({
  head: () => ({
    meta: [
      { title: "CMS — Website" },
      {
        name: "description",
        content:
          "Create and edit the primary site's pages by type — home, product, platform, blog, landing and dev — with a draft to publish workflow, SEO fields and body blocks.",
      },
      { property: "og:title", content: "CMS — Website" },
      { property: "og:description", content: "Update a site page in minutes: draft, edit, publish." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CmsPage,
});

function CmsPage() {
  const qc = useQueryClient();
  const role = useOptionalRole();
  const editor = role?.user?.email ?? role?.activeRole ?? "console";
  const { data: pages, isLoading } = useQuery({ queryKey: ["web-pages"], queryFn: loadPages });
  const { data: pageTemplates = [] } = useQuery({
    queryKey: ["web-page-templates"],
    queryFn: loadPageTemplates,
  });
  const { data: deletedPages = [] } = useQuery({
    queryKey: ["web-pages-trash"],
    queryFn: loadDeletedPages,
  });
  const { data: deletedTemplates = [] } = useQuery({
    queryKey: ["web-page-templates-trash"],
    queryFn: loadDeletedPageTemplates,
  });
  const { data: deletedNavs = [] } = useQuery({
    queryKey: ["nav-menus-trash"],
    queryFn: loadDeletedNavMenus,
  });
  const trashCount = deletedPages.length + deletedTemplates.length + deletedNavs.length;

  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [newPageMode, setNewPageMode] = useState<"blank" | "template">("blank");
  const [newTemplateId, setNewTemplateId] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<string>("landing");
  const [selected, setSelected] = useState<WebPage | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [editorTab, setEditorTab] = useState<"visual" | "json">("visual");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [section, setSection] = useState<CmsSection>("pages");
  const [templateSource, setTemplateSource] = useState<WebPage | null>(null);
  const [focusTemplateId, setFocusTemplateId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    title: string;
    slug: string;
    seo_title: string;
    seo_desc: string;
    body: string;
    design_tag: DesignTag;
  }>({ title: "", slug: "", seo_title: "", seo_desc: "", body: "", design_tag: "old_design" });
  // What the preview column renders: the visual blocks, or the JSON tab's text when it parses.
  const previewBlocks = useMemo<Block[]>(() => {
    if (editorTab === "visual") return blocks;
    try {
      const parsed = JSON.parse(draft.body);
      return Array.isArray(parsed) ? (parsed as Block[]) : blocks;
    } catch {
      return blocks;
    }
  }, [editorTab, blocks, draft.body]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["web-pages"] });
    qc.invalidateQueries({ queryKey: ["web-pages-trash"] });
  };

  const create = useMutation({
    mutationFn: async () => {
      if (!newTitle.trim()) throw new Error("Enter a page title");
      if (newPageMode === "blank") {
        return webMutations.createPage({
          title: newTitle.trim(),
          slug: slugify(newTitle),
          page_type: newType,
          updated_by: editor,
        });
      }
      const template = pageTemplates.find((item) => item.id === newTemplateId);
      if (!template) throw new Error("Choose a template");
      return webMutations.createPageFromTemplate({
        title: newTitle.trim(),
        page_type: newType,
        body: template.body,
        settings: (template.page_settings ?? {}) as Record<string, unknown>,
        updated_by: editor,
      });
    },
    onSuccess: async (page) => {
      if (newPageMode === "template") {
        await role?.logAudit("cms_template_apply", newTemplateId, {
          mode: "new",
          page_id: (page as WebPage).id,
        });
      }
      toast.success(newPageMode === "template" ? "Draft created from template" : "Blank draft created");
      setNewTitle("");
      setNewPageMode("blank");
      setNewTemplateId("");
      setCreating(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const save = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error("No page selected");
      let body: unknown = selected.body;
      if (editorTab === "visual") {
        body = blocks;
      } else {
        const raw = draft.body.trim();
        if (raw) {
          try {
            body = JSON.parse(raw);
          } catch {
            body = { markdown: raw };
          }
        }
      }
      return webMutations.updatePage(selected.id, {
        title: draft.title,
        slug: slugify(draft.slug || draft.title),
        seo_title: draft.seo_title || null,
        seo_desc: draft.seo_desc || null,
        body: body as WebPage["body"],
        design_tag: draft.design_tag,
        updated_by: editor,
      });
    },
    onSuccess: () => {
      toast.success("Page saved");
      setSelected(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const publish = useMutation({
    mutationFn: (p: WebPage) =>
      p.status === "published" ? webMutations.unpublishPage(p.id) : webMutations.publishPage(p.id, editor),
    onSuccess: () => {
      toast.success("Publish state updated");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => webMutations.deletePage(id, editor),
    onSuccess: () => {
      toast.success("Page deleted");
      setSelected(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const duplicate = useMutation({
    mutationFn: (p: WebPage) => webMutations.duplicatePage(p, editor),
    onSuccess: () => {
      toast.success("Page duplicated as a draft");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulk = useMutation({
    mutationFn: async (action: "publish" | "unpublish" | "delete") => {
      if (!selectedIds.length) throw new Error("Select at least one page");
      if (action === "publish") return webMutations.bulkPublishPages(selectedIds, editor);
      if (action === "unpublish") return webMutations.bulkUnpublishPages(selectedIds);
      return webMutations.bulkDeletePages(selectedIds, editor);
    },
    onSuccess: (_d, action) => {
      toast.success(
        action === "delete"
          ? `${selectedIds.length} page(s) deleted`
          : `${selectedIds.length} page(s) ${action === "publish" ? "published" : "unpublished"}`,
      );
      setSelectedIds([]);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = useMemo(() => {
    const list = pages ?? [];
    const needle = q.trim().toLowerCase();
    return list.filter(
      (p) =>
        (typeFilter === "all" || p.page_type === typeFilter) &&
        (!needle ||
          (p.title ?? "").toLowerCase().includes(needle) ||
          (p.slug ?? "").toLowerCase().includes(needle)),
    );
  }, [pages, typeFilter, q]);

  const published = (pages ?? []).filter((p) => p.status === "published").length;
  const drafts = (pages ?? []).length - published;

  function openPage(p: WebPage) {
    setSelected(p);
    setBlocks(blocksOf(p.body));
    setEditorTab("visual");
    setDraft({
      title: p.title ?? "",
      slug: p.slug ?? "",
      seo_title: p.seo_title ?? "",
      seo_desc: p.seo_desc ?? "",
      design_tag: (p.design_tag === "new" ? "new" : "old_design") as DesignTag,
      body:
        p.body && typeof p.body === "object" && "markdown" in (p.body as Record<string, unknown>)
          ? String((p.body as Record<string, unknown>).markdown ?? "")
          : p.body
            ? JSON.stringify(p.body, null, 2)
            : "",
    });
  }

  function openCreateDialog() {
    setNewTitle("");
    setNewType("landing");
    setNewPageMode("blank");
    setNewTemplateId("");
    setCreating(true);
  }

  function chooseTemplate(template: WebPageTemplate) {
    setNewTemplateId(template.id);
    const settings = (template.page_settings ?? {}) as Record<string, unknown>;
    const templateType = typeof settings.page_type === "string" ? settings.page_type : "landing";
    setNewType(PAGE_TYPES.includes(templateType as PageType) ? templateType : "landing");
  }

  return (
    <PageBody>
      <PageHeader
        eyebrow="Website · CMS"
        title="Site content"
        description="Every page of the primary site, by type, with a draft → publish workflow. Edit copy, SEO and body blocks (JSON blocks or markdown) and ship in minutes."
        actions={
          <Button onClick={openCreateDialog} className="gap-1.5">
            <Plus className="h-4 w-4" /> New page
          </Button>
        }
      />

      <Tabs
        value={section}
        onValueChange={(value) => {
          if (value !== "templates") setFocusTemplateId(null);
          setSection(value as CmsSection);
        }}
      >
        <TabsList>
          <TabsTrigger value="pages" className="gap-1.5"><FileText className="h-4 w-4" /> Pages</TabsTrigger>
          <TabsTrigger value="templates" className="gap-1.5"><LayoutTemplate className="h-4 w-4" /> Templates</TabsTrigger>
          <TabsTrigger value="navigation" className="gap-1.5"><Link2 className="h-4 w-4" /> Navigation</TabsTrigger>
          <TabsTrigger value="trash" className="gap-1.5">
            <Trash2 className="h-4 w-4" /> Trash
            {trashCount ? (
              <span className="ml-1 rounded-full bg-[color:var(--color-surface-3)] px-1.5 text-[11px] font-semibold">
                {trashCount}
              </span>
            ) : null}
          </TabsTrigger>
        </TabsList>

      <TabsContent value="pages" className="mt-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Pages" value={pages?.length ?? 0} icon={<FileText className="h-4 w-4" />} loading={isLoading} />
        <StatTile label="Published" value={published} tone="green" loading={isLoading} />
        <StatTile label="Drafts" value={drafts} tone="yellow" loading={isLoading} />
      </div>

      <Panel
        className="mt-6"
        title="Pages"
        actions={
          <div className="flex items-center gap-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search title or slug"
              className="h-8 w-56"
            />
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-8 w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {PAGE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
        bodyClassName="px-3 py-2"
      >
        {selectedIds.length ? (
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-[12px] border border-[color:var(--color-hairline)] bg-[color:var(--color-surface-2)] px-3 py-2">
            <span className="text-xs font-semibold text-[color:var(--color-ink-2)]">
              {selectedIds.length} selected
            </span>
            <div className="ml-auto flex flex-wrap gap-2">
              {selectedIds.length === 1 && role?.canEdit ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => setTemplateSource((pages ?? []).find((page) => page.id === selectedIds[0]) ?? null)}
                >
                  <Shapes className="h-3.5 w-3.5" /> Create template
                </Button>
              ) : null}
              <Button size="sm" variant="outline" disabled={bulk.isPending} onClick={() => bulk.mutate("publish")}>
                Publish
              </Button>
              <Button size="sm" variant="outline" disabled={bulk.isPending} onClick={() => bulk.mutate("unpublish")}>
                Unpublish
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-[#c5221f]"
                disabled={bulk.isPending}
                onClick={() => {
                  if (confirm(`Delete ${selectedIds.length} page(s)? This cannot be undone.`)) bulk.mutate("delete");
                }}
              >
                Delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedIds([])}>
                Clear
              </Button>
            </div>
          </div>
        ) : null}
        <DataTable
          columns={[
            {
              key: "select",
              width: "40px",
              header: (
                <Checkbox
                  checked={rows.length > 0 && selectedIds.length === rows.length}
                  onCheckedChange={(v) => setSelectedIds(v ? rows.map((r) => r.id) : [])}
                  aria-label="Select all pages"
                />
              ),
              cell: (p) => (
                <span onClick={(e) => e.stopPropagation()} className="inline-flex">
                  <Checkbox
                    checked={selectedIds.includes(p.id)}
                    onCheckedChange={(v) =>
                      setSelectedIds((prev) => (v ? [...new Set([...prev, p.id])] : prev.filter((id) => id !== p.id)))
                    }
                    aria-label={`Select ${p.title ?? "page"}`}
                  />
                </span>
              ),
            },
            {
              key: "title",
              header: "Page",
              cell: (p) => (
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink">{p.title ?? "Untitled"}</div>
                  <div className="truncate text-xs text-[color:var(--color-ink-3)]">/{p.slug ?? ""}</div>
                </div>
              ),
            },
            { key: "type", header: "Type", cell: (p) => <Pill value={p.page_type} /> },
            { key: "status", header: "Status", cell: (p) => <Pill value={p.status} /> },
            {
              key: "design",
              header: "Design",
              cell: (p) => (
                <span
                  className={
                    "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide " +
                    (p.design_tag === "new"
                      ? "bg-[#e6f4ea] text-[#137333]"
                      : "bg-[color:var(--color-surface-3)] text-[color:var(--color-ink-2)]")
                  }
                >
                  {DESIGN_TAG_LABEL[p.design_tag ?? "old_design"] ?? "Old design"}
                </span>
              ),
            },
            {
              key: "template",
              header: "Template",
              cell: (p) => {
                const template = pageTemplates.find((t) => t.id === p.template_id);
                return template ? (
                  <span className="text-xs font-medium text-[color:var(--color-ink-2)]">{template.name}</span>
                ) : (
                  <span className="text-xs text-[color:var(--color-ink-3)]">Not template-driven</span>
                );
              },
            },
            {
              key: "updated",
              header: "Updated",
              cell: (p) => (
                <span className="text-xs text-[color:var(--color-ink-2)]">
                  {p.updated_at ? new Date(p.updated_at).toLocaleString() : "—"}
                  {p.updated_by ? ` · ${p.updated_by}` : ""}
                </span>
              ),
            },
            {
              key: "actions",
              header: "",
              align: "right",
              cell: (p) => (
                <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                  <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-8 w-8" asChild>
                        <a
                          href={publicPathForPage(p)}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Preview ${p.title ?? "page"}`}
                        >
                          <Eye className="h-4 w-4" />
                        </a>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Preview</TooltipContent>
                  </Tooltip>
                  </TooltipProvider>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="outline" className="gap-1">
                        Edit <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem onClick={() => openPage(p)}>
                        <Pencil className="mr-2 h-4 w-4" /> Edit content
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={!p.template_id}
                        onClick={() => {
                          if (!p.template_id) return;
                          setFocusTemplateId(p.template_id);
                          setSection("templates");
                        }}
                      >
                        <LayoutTemplate className="mr-2 h-4 w-4" /> Edit template
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => duplicate.mutate(p)}
                        disabled={duplicate.isPending}
                      >
                        <Copy className="mr-2 h-4 w-4" /> Duplicate
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    size="sm"
                    variant={p.status === "published" ? "outline" : "default"}
                    disabled={publish.isPending}
                    onClick={(e) => {
                      e.stopPropagation();
                      publish.mutate(p);
                    }}
                  >
                    {p.status === "published" ? "Unpublish" : "Publish"}
                  </Button>
                </div>
              ),
            },
          ]}
          rows={rows}
          getRowKey={(p) => p.id}
          onRowClick={openPage}
          loading={isLoading}
          empty={
            <EmptyState
              icon={<FileText className="h-4 w-4" />}
              title="No pages yet"
              description="The CMS is live and empty — create the first page and publish it when it is ready."
              action={<Button onClick={openCreateDialog}>New page</Button>}
            />
          }
        />
      </Panel>

      <DetailDrawer
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        title={draft.title || "Edit page"}
        description={selected ? `${selected.page_type ?? "page"} · ${selected.status ?? "draft"}` : undefined}
        aside={
          <PagePreview
            title={draft.title || "Untitled page"}
            blocks={previewBlocks}
            routePath={selected ? publicPathForPage(selected) : null}
            codeRendered={selected?.code_rendered}
          />
        }
        footer={
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              className="text-[#c5221f]"
              onClick={() => selected && remove.mutate(selected.id)}
              disabled={remove.isPending}
            >
              Delete
            </Button>
            <div className="flex gap-2">
              {selected ? (
                <Button variant="outline" className="gap-1.5" asChild>
                  <a
                    href={publicPathForPage({
                      page_type: selected.page_type,
                      slug: draft.slug || selected.slug,
                      route_path: selected.route_path,
                    })}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="h-4 w-4" /> Preview
                  </a>
                </Button>
              ) : null}
              {selected ? (
                <Button variant="outline" onClick={() => publish.mutate(selected)} disabled={publish.isPending}>
                  {selected.status === "published" ? "Unpublish" : "Publish"}
                </Button>
              ) : null}
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                Save
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          {selected?.code_rendered ? (
            <div className="rounded-lg border border-[#c6dafc] bg-[#e8f0fe] p-3 text-xs leading-relaxed text-[#174ea6]">
              This page has a designed layout built in code and lives at{" "}
              <span className="font-semibold">{selected.route_path}</span>. Preview opens the real page. The
              text below is a plain-text copy for search settings and reference — editing it does not change
              the live design.
            </div>
          ) : null}
          <FieldRow label="Title">
            <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </FieldRow>
          <FieldRow label="Slug">
            <Input value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} />
          </FieldRow>
          <FieldRow label="SEO title">
            <Input value={draft.seo_title} onChange={(e) => setDraft({ ...draft, seo_title: e.target.value })} />
          </FieldRow>
          <FieldRow label="SEO description">
            <Textarea
              rows={3}
              value={draft.seo_desc}
              onChange={(e) => setDraft({ ...draft, seo_desc: e.target.value })}
            />
          </FieldRow>
          <FieldRow label="Design tag">
            <Select
              value={draft.design_tag}
              onValueChange={(v) => setDraft({ ...draft, design_tag: v as DesignTag })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DESIGN_TAGS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {DESIGN_TAG_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
          <Tabs value={editorTab} onValueChange={(v) => setEditorTab(v as "visual" | "json")}>
            <TabsList>
              <TabsTrigger value="visual">Visual editor</TabsTrigger>
              <TabsTrigger value="json">JSON</TabsTrigger>
            </TabsList>
            <TabsContent value="visual" className="mt-4">
              <SectionEditor blocks={blocks} onChange={setBlocks} />
              <p className="mt-3 text-xs text-[color:var(--color-ink-3)]">
                Blocks render on the public site exactly in this order. Rich text is edited visually and
                stored as sanitized HTML.
              </p>
            </TabsContent>
            <TabsContent value="json" className="mt-4">
              <FieldRow label="Body (JSON blocks or markdown)">
                <Textarea
                  rows={16}
                  className="font-mono text-xs"
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                />
              </FieldRow>
              <p className="mt-3 text-xs text-[color:var(--color-ink-3)]">
                Valid JSON is stored as blocks; anything else is stored as markdown. Saving from this tab
                overwrites the visual edits.
              </p>
            </TabsContent>
          </Tabs>
        </div>
      </DetailDrawer>
      </TabsContent>
      <TabsContent forceMount value="templates" className="mt-6 data-[state=inactive]:hidden">
        <TemplateManager
          pages={pages ?? []}
          createSource={templateSource}
          onCreateClosed={() => setTemplateSource(null)}
          focusTemplateId={focusTemplateId}
        />
      </TabsContent>
      <TabsContent value="navigation" className="mt-6">
        <NavManager />
      </TabsContent>
      <TabsContent value="trash" className="mt-6">
        <CmsTrash
          pages={deletedPages}
          templates={deletedTemplates}
          navs={deletedNavs}
          canManage={role?.canEdit !== false}
        />
      </TabsContent>
      </Tabs>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create a new page</DialogTitle>
            <DialogDescription>Start with a blank page or use a saved template.</DialogDescription>
          </DialogHeader>

          <RadioGroup
            value={newPageMode}
            onValueChange={(value) => setNewPageMode(value as "blank" | "template")}
            className="grid gap-3 sm:grid-cols-2"
          >
            <label className="flex cursor-pointer gap-3 rounded-md border border-border p-4">
              <RadioGroupItem value="blank" />
              <span>
                <span className="block text-sm font-semibold">Blank page</span>
                <span className="text-xs text-muted-foreground">Start with an empty draft.</span>
              </span>
            </label>
            <label className="flex cursor-pointer gap-3 rounded-md border border-border p-4">
              <RadioGroupItem value="template" />
              <span>
                <span className="block text-sm font-semibold">Use a template</span>
                <span className="text-xs text-muted-foreground">Populate the draft with saved content.</span>
              </span>
            </label>
          </RadioGroup>

          {newPageMode === "template" ? (
            <FieldRow label="Template">
              {pageTemplates.length ? (
                <Select
                  value={newTemplateId}
                  onValueChange={(id) => {
                    const template = pageTemplates.find((item) => item.id === id);
                    if (template) chooseTemplate(template);
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Choose a template" /></SelectTrigger>
                  <SelectContent>
                    {pageTemplates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name} · {template.template_kind === "page" ? "whole page" : "section"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                  No templates yet. Create one from an existing page in the Templates section.
                </div>
              )}
            </FieldRow>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="Page title">
              <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Platform overview" />
            </FieldRow>
            <FieldRow label="Page type">
              <Select value={newType} onValueChange={setNewType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAGE_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                </SelectContent>
              </Select>
            </FieldRow>
          </div>
          {newTitle.trim() ? <p className="text-xs text-muted-foreground">Slug: /{slugify(newTitle)}</p> : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              disabled={!newTitle.trim() || (newPageMode === "template" && !newTemplateId) || create.isPending}
              onClick={() => create.mutate()}
            >
              Create draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageBody>
  );
}


/* ─────────── Trash: recover deleted pages and templates ─────────── */
function CmsTrash({
  pages,
  templates,
  navs,
  canManage,
}: {
  pages: WebPage[];
  templates: WebPageTemplate[];
  navs: NavMenu[];
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["web-pages"] });
    qc.invalidateQueries({ queryKey: ["web-pages-trash"] });
    qc.invalidateQueries({ queryKey: ["web-page-templates"] });
    qc.invalidateQueries({ queryKey: ["web-page-templates-trash"] });
    qc.invalidateQueries({ queryKey: ["nav-menus"] });
    qc.invalidateQueries({ queryKey: ["nav-menus-trash"] });
  };
  const act = useMutation({
    mutationFn: async (job: () => Promise<unknown>) => {
      await job();
    },
    onSuccess: () => {
      refresh();
      toast.success("Trash updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

  return (
    <div className="space-y-6">
      <Panel
        title="Deleted pages"
        description="Pages stay here after deletion so nothing is lost by accident. Restore brings a page back as a draft."
      >
        <DataTable<WebPage>
          columns={[
            {
              key: "title",
              header: "Page",
              cell: (p) => (
                <div>
                  <div className="text-sm font-medium text-ink">{p.title ?? "Untitled"}</div>
                  <div className="text-xs text-[color:var(--color-ink-3)]">/{p.slug ?? ""}</div>
                </div>
              ),
            },
            { key: "type", header: "Type", cell: (p) => <Pill value={p.page_type} /> },
            {
              key: "deleted",
              header: "Deleted",
              cell: (p) => (
                <span className="text-xs text-[color:var(--color-ink-2)]">
                  {when(p.deleted_at)}
                  {p.deleted_by ? ` · ${p.deleted_by}` : ""}
                </span>
              ),
            },
            {
              key: "actions",
              header: "",
              align: "right",
              cell: (p) => (
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    disabled={!canManage || act.isPending}
                    onClick={() => act.mutate(() => webMutations.restorePage(p.id))}
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Restore
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1 text-[#c5221f]"
                    disabled={!canManage || act.isPending}
                    onClick={() => {
                      if (!window.confirm(`Permanently delete "${p.title ?? "this page"}"? This cannot be undone.`)) return;
                      act.mutate(() => webMutations.purgePage(p.id));
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete forever
                  </Button>
                </div>
              ),
            },
          ]}
          rows={pages}
          getRowKey={(p) => p.id}
          empty={
            <EmptyState
              icon={<Trash2 className="h-4 w-4" />}
              title="Nothing deleted"
              description="Deleted pages will appear here, ready to restore."
            />
          }
        />
      </Panel>

      <Panel title="Deleted templates" description="Removed page and section templates, recoverable at any time.">
        <DataTable<WebPageTemplate>
          columns={[
            {
              key: "name",
              header: "Template",
              cell: (t) => (
                <div>
                  <div className="text-sm font-medium text-ink">{t.name}</div>
                  <div className="text-xs text-[color:var(--color-ink-3)]">
                    {t.template_kind === "page" ? "Whole page" : "Section"}
                    {t.source_page_title ? ` · from ${t.source_page_title}` : ""}
                  </div>
                </div>
              ),
            },
            {
              key: "deleted",
              header: "Deleted",
              cell: (t) => (
                <span className="text-xs text-[color:var(--color-ink-2)]">
                  {when(t.deleted_at)}
                  {t.deleted_by ? ` · ${t.deleted_by}` : ""}
                </span>
              ),
            },
            {
              key: "actions",
              header: "",
              align: "right",
              cell: (t) => (
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    disabled={!canManage || act.isPending}
                    onClick={() => act.mutate(() => webMutations.restorePageTemplate(t.id))}
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Restore
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1 text-[#c5221f]"
                    disabled={!canManage || act.isPending}
                    onClick={() => {
                      if (!window.confirm(`Permanently delete "${t.name}"? This cannot be undone.`)) return;
                      act.mutate(() => webMutations.purgePageTemplate(t.id));
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete forever
                  </Button>
                </div>
              ),
            },
          ]}
          rows={templates}
          getRowKey={(t) => t.id}
          empty={
            <EmptyState
              icon={<Trash2 className="h-4 w-4" />}
              title="Nothing deleted"
              description="Deleted templates will appear here, ready to restore."
            />
          }
        />
      </Panel>
      <Panel title="Deleted navigations" description="Removed top navs and footers, recoverable at any time.">
        <DataTable<NavMenu>
          columns={[
            {
              key: "name",
              header: "Navigation",
              cell: (n) => (
                <div>
                  <div className="text-sm font-medium text-ink">{n.name}</div>
                  <div className="text-xs text-[color:var(--color-ink-3)]">
                    {n.menu_type === "header" ? "Top nav" : "Footer"} · {siteLabel(n.assigned_site)}
                  </div>
                </div>
              ),
            },
            {
              key: "deleted",
              header: "Deleted",
              cell: (n) => (
                <span className="text-xs text-[color:var(--color-ink-2)]">{when(n.deleted_at)}</span>
              ),
            },
            {
              key: "actions",
              header: "",
              align: "right",
              cell: (n) => (
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    disabled={!canManage || act.isPending}
                    onClick={() => act.mutate(() => navMutations.restore(n.id))}
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Restore
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1 text-[#c5221f]"
                    disabled={!canManage || act.isPending}
                    onClick={() => {
                      if (!window.confirm(`Permanently delete "${n.name}"? This cannot be undone.`)) return;
                      act.mutate(() => navMutations.hardDelete(n.id));
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete forever
                  </Button>
                </div>
              ),
            },
          ]}
          rows={navs}
          getRowKey={(n) => n.id}
          empty={
            <EmptyState
              icon={<Trash2 className="h-4 w-4" />}
              title="Nothing deleted"
              description="Deleted navigations will appear here, ready to restore."
            />
          }
        />
      </Panel>
    </div>
  );
}
