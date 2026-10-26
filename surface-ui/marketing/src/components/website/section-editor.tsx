import { useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  GripVertical,
  ImageIcon,
  Loader2,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
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
import { FieldRow } from "@v3/shared/public/components/website-bits";
import { RichTextEditor } from "@v3/marketing/components/website/rich-text-editor";
import { supabase } from "@v3/state/auth/adapters/supabase/client";
import {
  MARKETING_IMAGE_BUCKET,
  resolveSectionImage,
  sectionImageKeys,
} from "@v3/shared/public/utils/marketing/section-images";
import { ICON_CHOICES } from "@v3/shared/components/icons/icon";
import {
  ITEM_FIELD_LABEL,
  SECTION_SPECS,
  SPEC_BY_TYPE,
  blankSection,
  type ItemField,
} from "@v3/marketing/components/website/section-schema";
import type { Block, BlockCta, BlockItem } from "@v3/shared/public/utils/public-site";

/* ───────────────────────── image field ───────────────────────── */

function ImageField({
  value,
  onChange,
  label,
}: {
  value?: string;
  onChange: (next: string) => void;
  label: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const preview = resolveSectionImage(value);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
      const path = `cms/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(MARKETING_IMAGE_BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from(MARKETING_IMAGE_BUCKET).getPublicUrl(path);
      onChange(data.publicUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <FieldRow label={label}>
      <div className="space-y-2">
        <div className="flex items-start gap-3">
          <div className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md border border-[color:var(--color-hairline)] bg-white">
            {preview ? (
              <img src={preview} alt="" className="h-full w-full object-contain" />
            ) : (
              <ImageIcon className="h-5 w-5 text-[color:var(--color-ink-3)]" />
            )}
          </div>
          <div className="flex-1 space-y-2">
            <Input
              className="h-8"
              placeholder="Paste an image address, or pick / upload below"
              value={value ?? ""}
              onChange={(e) => onChange(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Select value="" onValueChange={(v) => onChange(v)}>
                <SelectTrigger className="h-8 w-52">
                  <SelectValue placeholder="Choose an existing image" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {sectionImageKeys.map((k) => (
                    <SelectItem key={k} value={k}>
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {value ? "Replace" : "Upload"}
              </Button>
              {value ? (
                <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => onChange("")}>
                  Remove
                </Button>
              ) : null}
            </div>
          </div>
        </div>
        {error ? <p className="text-xs text-[#c5221f]">{error}</p> : null}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = "";
          }}
        />
      </div>
    </FieldRow>
  );
}

/* ───────────────────────── button rows ───────────────────────── */

function CtaRows({
  ctas,
  onChange,
}: {
  ctas: BlockCta[];
  onChange: (next: BlockCta[]) => void;
}) {
  const patch = (i: number, next: Partial<BlockCta>) =>
    onChange(ctas.map((c, ci) => (ci === i ? { ...c, ...next } : c)));
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-ink-3)]">
          Buttons
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => onChange([...ctas, { label: "Schedule a Call", href: "/request-a-demo" }])}
        >
          <Plus className="h-3.5 w-3.5" /> Add button
        </Button>
      </div>
      <div className="space-y-2">
        {ctas.map((c, ci) => (
          <div key={ci} className="grid gap-2 sm:grid-cols-[1fr_1fr_8rem_1fr_auto]">
            <Input className="h-8" placeholder="Button text" value={c.label ?? ""} onChange={(e) => patch(ci, { label: e.target.value })} />
            <Input className="h-8" placeholder="/path or https://…" value={c.href ?? ""} onChange={(e) => patch(ci, { href: e.target.value })} />
            <Select value={c.variant ?? "primary"} onValueChange={(v) => patch(ci, { variant: v as BlockCta["variant"] })}>
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="primary">Solid blue</SelectItem>
                <SelectItem value="secondary">Outline</SelectItem>
                <SelectItem value="white">White</SelectItem>
                <SelectItem value="ghost">Text only</SelectItem>
              </SelectContent>
            </Select>
            <Input className="h-8" placeholder="Small note under button" value={c.note ?? ""} onChange={(e) => patch(ci, { note: e.target.value })} />
            <Button size="icon" variant="ghost" className="h-8 w-8 text-[#c5221f]" onClick={() => onChange(ctas.filter((_, x) => x !== ci))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────── bullets ───────────────────────── */

function BulletList({ bullets, onChange }: { bullets: string[]; onChange: (next: string[]) => void }) {
  return (
    <div className="sm:col-span-2">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-ink-3)]">
          Checkmark bullets
        </span>
        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => onChange([...bullets, ""])}>
          <Plus className="h-3.5 w-3.5" /> Add bullet
        </Button>
      </div>
      <div className="space-y-2">
        {bullets.map((b, bi) => (
          <div key={bi} className="flex gap-2">
            <Textarea
              rows={2}
              value={b}
              onChange={(e) => onChange(bullets.map((x, xi) => (xi === bi ? e.target.value : x)))}
            />
            <Button size="icon" variant="ghost" className="h-8 w-8 text-[#c5221f]" onClick={() => onChange(bullets.filter((_, xi) => xi !== bi))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────── item field ───────────────────────── */

function ItemFieldInput({
  field,
  item,
  onChange,
}: {
  field: ItemField;
  item: BlockItem;
  onChange: (next: Partial<BlockItem>) => void;
}) {
  const label = ITEM_FIELD_LABEL[field];
  if (field === "bullets") {
    return <BulletList bullets={item.bullets ?? []} onChange={(bullets) => onChange({ bullets })} />;
  }
  if (field === "image" || field === "logo") {
    return (
      <div className="sm:col-span-2">
        <ImageField label={label} value={item[field] ?? ""} onChange={(v) => onChange({ [field]: v } as Partial<BlockItem>)} />
      </div>
    );
  }
  if (field === "icon") {
    return (
      <FieldRow label={label}>
        <Select value={item.icon ?? "Check"} onValueChange={(v) => onChange({ icon: v })}>
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {ICON_CHOICES.map((n) => (
              <SelectItem key={n} value={n}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldRow>
    );
  }
  if (field === "imagePosition") {
    return (
      <FieldRow label={label}>
        <Select value={item.imagePosition ?? "left"} onValueChange={(v) => onChange({ imagePosition: v as "left" | "right" })}>
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="left">Image on the left</SelectItem>
            <SelectItem value="right">Image on the right</SelectItem>
          </SelectContent>
        </Select>
      </FieldRow>
    );
  }
  const long = field === "body" || field === "answer" || field === "quote";
  return (
    <div className={long ? "sm:col-span-2" : undefined}>
      <FieldRow label={label}>
        {long ? (
          <Textarea rows={3} value={String(item[field] ?? "")} onChange={(e) => onChange({ [field]: e.target.value } as Partial<BlockItem>)} />
        ) : (
          <Input className="h-8" value={String(item[field] ?? "")} onChange={(e) => onChange({ [field]: e.target.value } as Partial<BlockItem>)} />
        )}
      </FieldRow>
    </div>
  );
}

/* ───────────────────────── section card ───────────────────────── */

function SectionCard({
  block,
  index,
  total,
  onPatch,
  onMove,
  onDuplicate,
  onDelete,
  dragHandlers,
}: {
  block: Block;
  index: number;
  total: number;
  onPatch: (next: Partial<Block>) => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  dragHandlers: {
    onDragStart: () => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: () => void;
    onDragEnd: () => void;
  };
}) {
  const [open, setOpen] = useState(false);
  const spec = SPEC_BY_TYPE[String(block.type)];
  const items = block.items ?? [];
  const patchItem = (ii: number, next: Partial<BlockItem>) =>
    onPatch({ items: items.map((x, xi) => (xi === ii ? { ...x, ...next } : x)) });

  return (
    <div
      draggable
      onDragStart={dragHandlers.onDragStart}
      onDragOver={dragHandlers.onDragOver}
      onDrop={dragHandlers.onDrop}
      onDragEnd={dragHandlers.onDragEnd}
      className="rounded-[12px] border border-[color:var(--color-hairline)] bg-[color:var(--color-surface-2)] p-4"
    >
      <div className="flex items-center gap-2">
        <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-[color:var(--color-ink-3)]" />
        <button
          type="button"
          className="flex-1 text-left"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="text-sm font-semibold">{spec?.label ?? String(block.type)}</span>
          <span className="ml-2 text-xs text-[color:var(--color-ink-3)]">
            {block.headline || block.eyebrow || `Section ${index + 1}`}
          </span>
        </button>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" className="h-8 w-8" disabled={index === 0} onClick={() => onMove(-1)}>
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" disabled={index === total - 1} onClick={() => onMove(1)}>
            <ChevronDown className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" title="Duplicate" onClick={onDuplicate}>
            <Copy className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 text-[#c5221f]" title="Delete" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {open ? (
        <div className="mt-4 grid gap-3">
          <FieldRow label="Section type">
            <Select value={String(block.type)} onValueChange={(v) => onPatch({ type: v })}>
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {/* Hand-typed pricing tables are retired: prices come from the catalog. Existing pricing sections stay editable. */}
                {SECTION_SPECS.filter((s) => s.type !== "pricing" || s.type === block.type).map((s) => (
                  <SelectItem key={s.type} value={s.type}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
          {spec ? <p className="text-xs text-[color:var(--color-ink-3)]">{spec.description}</p> : null}

          {spec?.fields.includes("eyebrow") ? (
            <FieldRow label="Small label above the headline">
              <Input className="h-8" value={block.eyebrow ?? ""} onChange={(e) => onPatch({ eyebrow: e.target.value })} />
            </FieldRow>
          ) : null}
          {spec?.fields.includes("headline") ? (
            <FieldRow label="Headline">
              <Input className="h-8" value={block.headline ?? ""} onChange={(e) => onPatch({ headline: e.target.value })} />
            </FieldRow>
          ) : null}
          {spec?.fields.includes("accent") ? (
            <FieldRow label="Highlighted end of the headline">
              <Input className="h-8" value={block.accent ?? ""} onChange={(e) => onPatch({ accent: e.target.value })} />
            </FieldRow>
          ) : null}
          {spec?.fields.includes("subhead") ? (
            <FieldRow label="Intro paragraph">
              <Textarea rows={3} value={block.subhead ?? ""} onChange={(e) => onPatch({ subhead: e.target.value })} />
            </FieldRow>
          ) : null}
          {spec?.fields.includes("html") ? (
            <FieldRow label="Text">
              <RichTextEditor value={block.html ?? ""} onChange={(html) => onPatch({ html })} placeholder="Write the section…" />
            </FieldRow>
          ) : null}
          {spec?.fields.includes("note") ? (
            <FieldRow label="Small print">
              <Input className="h-8" value={block.note ?? ""} onChange={(e) => onPatch({ note: e.target.value })} />
            </FieldRow>
          ) : null}
          {spec?.fields.includes("theme") ? (
            <FieldRow label="Band colour">
              <Select value={block.theme ?? "light"} onValueChange={(v) => onPatch({ theme: v as "dark" | "light" })}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                </SelectContent>
              </Select>
            </FieldRow>
          ) : null}
          {spec?.fields.includes("image") ? (
            <ImageField label="Section image" value={block.image ?? ""} onChange={(v) => onPatch({ image: v })} />
          ) : null}
          {spec?.fields.includes("imageAlt") ? (
            <FieldRow label="Image description (alt)">
              <Input className="h-8" value={block.imageAlt ?? ""} onChange={(e) => onPatch({ imageAlt: e.target.value })} />
            </FieldRow>
          ) : null}
          {spec?.fields.includes("ctas") ? (
            <CtaRows ctas={block.ctas ?? []} onChange={(ctas) => onPatch({ ctas })} />
          ) : null}

          {spec?.fields.includes("panels") ? (
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-ink-3)]">
                  Panels
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() =>
                    onPatch({
                      panels: [...(block.panels ?? []), { label: "New panel", cta: { label: "Get started", href: "/" } }],
                    })
                  }
                >
                  <Plus className="h-3.5 w-3.5" /> Add panel
                </Button>
              </div>
              <div className="space-y-3">
                {(block.panels ?? []).map((panel, pi) => {
                  const patchPanel = (next: Partial<NonNullable<Block["panels"]>[number]>) =>
                    onPatch({ panels: (block.panels ?? []).map((x, xi) => (xi === pi ? { ...x, ...next } : x)) });
                  return (
                    <div key={pi} className="rounded-[10px] border border-[color:var(--color-hairline)] bg-white p-3">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <FieldRow label="Panel label">
                          <Input className="h-8" value={panel.label ?? ""} onChange={(e) => patchPanel({ label: e.target.value })} />
                        </FieldRow>
                        <FieldRow label="Panel headline">
                          <Input className="h-8" value={panel.headline ?? ""} onChange={(e) => patchPanel({ headline: e.target.value })} />
                        </FieldRow>
                        <div className="sm:col-span-2">
                          <FieldRow label="Panel text">
                            <Textarea rows={2} value={panel.body ?? ""} onChange={(e) => patchPanel({ body: e.target.value })} />
                          </FieldRow>
                        </div>
                        <div className="sm:col-span-2">
                          <CtaRows
                            ctas={panel.cta ? [panel.cta] : []}
                            onChange={(next) => patchPanel({ cta: next[0] })}
                          />
                        </div>
                      </div>
                      <div className="mt-2 flex justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-[#c5221f]"
                          onClick={() => onPatch({ panels: (block.panels ?? []).filter((_, xi) => xi !== pi) })}
                        >
                          Remove panel
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {spec?.itemFields?.length ? (
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-ink-3)]">
                  {spec.itemLabel ?? "Item"}s
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => onPatch({ items: [...items, {}] })}
                >
                  <Plus className="h-3.5 w-3.5" /> Add {(spec.itemLabel ?? "item").toLowerCase()}
                </Button>
              </div>
              <div className="space-y-3">
                {items.map((item, ii) => (
                  <div key={ii} className="rounded-[10px] border border-[color:var(--color-hairline)] bg-white p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold">
                        {spec.itemLabel ?? "Item"} {ii + 1}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="Move up"
                          disabled={ii === 0}
                          onClick={() => {
                            const next = [...items];
                            [next[ii - 1], next[ii]] = [next[ii], next[ii - 1]];
                            onPatch({ items: next });
                          }}
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="Move down"
                          disabled={ii === items.length - 1}
                          onClick={() => {
                            const next = [...items];
                            [next[ii], next[ii + 1]] = [next[ii + 1], next[ii]];
                            onPatch({ items: next });
                          }}
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="Duplicate"
                          onClick={() => onPatch({ items: [...items.slice(0, ii + 1), { ...item }, ...items.slice(ii + 1)] })}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-[#c5221f]"
                          title="Remove"
                          onClick={() => onPatch({ items: items.filter((_, xi) => xi !== ii) })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {(spec.itemFields ?? []).map((f) => (
                        <ItemFieldInput key={f} field={f} item={item} onChange={(next) => patchItem(ii, next)} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ───────────────────────── editor ───────────────────────── */

/**
 * Section editor for CMS marketing pages: add, reorder (drag or arrows),
 * duplicate, delete, and edit every field of every section type the public
 * renderer supports. Nothing about a marketing page lives in code.
 */
export function SectionEditor({
  blocks,
  onChange,
}: {
  blocks: Block[];
  onChange: (next: Block[]) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const patch = (i: number, next: Partial<Block>) =>
    onChange(blocks.map((b, idx) => (idx === i ? { ...b, ...next } : b)));

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const dropAt = (target: number) => {
    if (dragIndex === null || dragIndex === target) return;
    const next = [...blocks];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(target, 0, moved);
    onChange(next);
    setDragIndex(null);
  };

  return (
    <div className="space-y-3">
      {blocks.map((block, i) => (
        <SectionCard
          key={i}
          block={block}
          index={i}
          total={blocks.length}
          onPatch={(next) => patch(i, next)}
          onMove={(dir) => move(i, dir)}
          onDuplicate={() =>
            onChange([...blocks.slice(0, i + 1), JSON.parse(JSON.stringify(block)) as Block, ...blocks.slice(i + 1)])
          }
          onDelete={() => onChange(blocks.filter((_, idx) => idx !== i))}
          dragHandlers={{
            onDragStart: () => setDragIndex(i),
            onDragOver: (e) => e.preventDefault(),
            onDrop: () => dropAt(i),
            onDragEnd: () => setDragIndex(null),
          }}
        />
      ))}

      {adding ? (
        <div className="rounded-[12px] border border-[color:var(--color-hairline)] bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">Add a section</span>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {SECTION_SPECS.filter((s) => !s.legacy).map((s) => (
              <button
                key={s.type}
                type="button"
                className="rounded-[10px] border border-[color:var(--color-hairline)] p-3 text-left hover:border-[color:var(--color-ink-3)]"
                onClick={() => {
                  onChange([...blocks, blankSection(s.type)]);
                  setAdding(false);
                }}
              >
                <span className="block text-sm font-semibold">{s.label}</span>
                <span className="text-xs text-[color:var(--color-ink-3)]">{s.description}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <Button variant="outline" className="w-full gap-1.5" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" /> Add section
        </Button>
      )}
    </div>
  );
}
