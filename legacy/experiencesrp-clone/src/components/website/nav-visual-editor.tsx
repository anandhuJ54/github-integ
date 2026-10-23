import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type FooterNavData,
  type HeaderNavData,
  type NavGroup,
  type NavLink,
  type NavMenuType,
} from "@/lib/nav-menus";

/* Lenient parsers: unlike the strict normalizers used for rendering, these keep
   half-finished rows so a blank link doesn't vanish while it is being typed. */
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function looseLinks(value: unknown): NavLink[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const link: NavLink = { label: str(item['label']), href: str(item['href']) };
    if (typeof item['blurb'] === "string") link.blurb = item['blurb'];
    return link;
  });
}

function looseHeader(value: unknown): HeaderNavData {
  const root = (value ?? {}) as Record<string, unknown>;
  const groups = Array.isArray(root['groups']) ? (root['groups'] as unknown[]) : [];
  const actions = Array.isArray(root['actions']) ? (root['actions'] as unknown[]) : [];
  return {
    groups: groups.map((raw) => {
      const g = (raw ?? {}) as Record<string, unknown>;
      const group: NavGroup = {
        kind: g['kind'] === "link" ? "link" : "menu",
        label: str(g['label']),
        href: str(g['href']),
        items: looseLinks(g['items']),
      };
      if (g['wide'] === true) group.wide = true;
      return group;
    }),
    actions: actions.map((raw) => {
      const a = (raw ?? {}) as Record<string, unknown>;
      return {
        label: str(a['label']),
        href: str(a['href']),
        style: a['style'] === "primary" ? ("primary" as const) : ("text" as const),
      };
    }),
  };
}

function looseFooter(value: unknown): FooterNavData {
  const root = (value ?? {}) as Record<string, unknown>;
  const columns = Array.isArray(root['columns']) ? (root['columns'] as unknown[]) : [];
  return {
    blurb: str(root['blurb']),
    columns: columns.map((raw) => {
      const c = (raw ?? {}) as Record<string, unknown>;
      return { title: str(c['title']), links: looseLinks(c['links']) };
    }),
  };
}

type Props = {
  menuType: NavMenuType;
  value: unknown;
  disabled?: boolean;
  onChange: (next: unknown) => void;
};

function move<T>(list: T[], index: number, delta: number): T[] {
  const next = [...list];
  const target = index + delta;
  if (target < 0 || target >= next.length) return next;
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item as T);
  return next;
}

function Row({
  title,
  onUp,
  onDown,
  onRemove,
  disabled,
  children,
}: {
  title: string;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex items-center gap-2">
        <GripVertical className="h-4 w-4 text-muted-foreground" />
        <p className="flex-1 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        <Button variant="ghost" size="sm" onClick={onUp} disabled={disabled} title="Move up">
          <ChevronUp className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={onDown} disabled={disabled} title="Move down">
          <ChevronDown className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={onRemove} disabled={disabled} title="Remove">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {children}
    </div>
  );
}

function LinkFields({
  link,
  withBlurb,
  disabled,
  onChange,
}: {
  link: NavLink;
  withBlurb?: boolean;
  disabled?: boolean;
  onChange: (next: NavLink) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Input
        value={link.label}
        placeholder="Link text"
        disabled={disabled}
        onChange={(event) => onChange({ ...link, label: event.target.value })}
      />
      <Input
        value={link.href}
        placeholder="/page-address"
        disabled={disabled}
        onChange={(event) => onChange({ ...link, href: event.target.value })}
      />
      {withBlurb ? (
        <Input
          className="sm:col-span-2"
          value={link.blurb ?? ""}
          placeholder="Short description (optional)"
          disabled={disabled}
          onChange={(event) => onChange({ ...link, blurb: event.target.value })}
        />
      ) : null}
    </div>
  );
}

function HeaderEditor({
  data,
  disabled,
  onChange,
}: {
  data: HeaderNavData;
  disabled?: boolean;
  onChange: (next: HeaderNavData) => void;
}) {
  const setGroups = (groups: NavGroup[]) => onChange({ ...data, groups });
  const setGroup = (index: number, patch: Partial<NavGroup>) =>
    setGroups(data.groups.map((g, i) => (i === index ? { ...g, ...patch } : g)));

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Menu items</p>
            <p className="text-xs text-muted-foreground">
              A dropdown holds several links. A single link goes straight to a page.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            className="gap-1.5"
            onClick={() =>
              setGroups([...data.groups, { kind: "menu", label: "New menu", items: [] }])
            }
          >
            <Plus className="h-4 w-4" /> Add item
          </Button>
        </div>

        {data.groups.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No menu items yet.
          </p>
        ) : null}

        {data.groups.map((group, index) => (
          <Row
            key={index}
            title={group.label || "Untitled"}
            disabled={disabled}
            onUp={() => setGroups(move(data.groups, index, -1))}
            onDown={() => setGroups(move(data.groups, index, 1))}
            onRemove={() => setGroups(data.groups.filter((_, i) => i !== index))}
          >
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  value={group.label}
                  placeholder="Menu title"
                  disabled={disabled}
                  onChange={(event) => setGroup(index, { label: event.target.value })}
                />
                <Select
                  value={group.kind}
                  onValueChange={(value) => setGroup(index, { kind: value as NavGroup["kind"] })}
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="menu">Dropdown with links</SelectItem>
                    <SelectItem value="link">Single link</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {group.kind === "link" ? (
                <Input
                  value={group.href ?? ""}
                  placeholder="/page-address"
                  disabled={disabled}
                  onChange={(event) => setGroup(index, { href: event.target.value })}
                />
              ) : (
                <div className="space-y-2 rounded-lg bg-muted/40 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Switch
                        checked={group.wide === true}
                        disabled={disabled}
                        onCheckedChange={(checked) => setGroup(index, { wide: checked })}
                      />
                      Wide dropdown
                    </label>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={disabled}
                      className="gap-1.5"
                      onClick={() =>
                        setGroup(index, {
                          items: [...(group.items ?? []), { label: "", href: "" }],
                        })
                      }
                    >
                      <Plus className="h-4 w-4" /> Add link
                    </Button>
                  </div>

                  {(group.items ?? []).map((link, linkIndex) => (
                    <div key={linkIndex} className="flex items-start gap-2">
                      <div className="flex-1">
                        <LinkFields
                          link={link}
                          withBlurb
                          disabled={disabled}
                          onChange={(next) =>
                            setGroup(index, {
                              items: (group.items ?? []).map((l, i) => (i === linkIndex ? next : l)),
                            })
                          }
                        />
                      </div>
                      <div className="flex flex-col">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={disabled}
                          onClick={() =>
                            setGroup(index, { items: move(group.items ?? [], linkIndex, -1) })
                          }
                        >
                          <ChevronUp className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={disabled}
                          onClick={() =>
                            setGroup(index, { items: move(group.items ?? [], linkIndex, 1) })
                          }
                        >
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={disabled}
                          onClick={() =>
                            setGroup(index, {
                              items: (group.items ?? []).filter((_, i) => i !== linkIndex),
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {(group.items ?? []).length === 0 ? (
                    <p className="text-xs text-muted-foreground">No links in this dropdown yet.</p>
                  ) : null}
                </div>
              )}
            </div>
          </Row>
        ))}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Buttons on the right</p>
            <p className="text-xs text-muted-foreground">Sign in, Start now, and similar.</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            className="gap-1.5"
            onClick={() =>
              onChange({ ...data, actions: [...data.actions, { label: "", href: "", style: "text" }] })
            }
          >
            <Plus className="h-4 w-4" /> Add button
          </Button>
        </div>

        {data.actions.map((action, index) => (
          <div key={index} className="flex items-start gap-2 rounded-lg border bg-card p-3">
            <div className="flex-1 grid gap-2 sm:grid-cols-3">
              <Input
                value={action.label}
                placeholder="Button text"
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...data,
                    actions: data.actions.map((a, i) =>
                      i === index ? { ...a, label: event.target.value } : a,
                    ),
                  })
                }
              />
              <Input
                value={action.href}
                placeholder="/page-address"
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...data,
                    actions: data.actions.map((a, i) =>
                      i === index ? { ...a, href: event.target.value } : a,
                    ),
                  })
                }
              />
              <Select
                value={action.style ?? "text"}
                disabled={disabled}
                onValueChange={(value) =>
                  onChange({
                    ...data,
                    actions: data.actions.map((a, i) =>
                      i === index ? { ...a, style: value as "primary" | "text" } : a,
                    ),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Plain text</SelectItem>
                  <SelectItem value="primary">Filled button</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() =>
                onChange({ ...data, actions: data.actions.filter((_, i) => i !== index) })
              }
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {data.actions.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No buttons yet.
          </p>
        ) : null}
      </section>
    </div>
  );
}

function FooterEditor({
  data,
  disabled,
  onChange,
}: {
  data: FooterNavData;
  disabled?: boolean;
  onChange: (next: FooterNavData) => void;
}) {
  const setColumns = (columns: FooterNavData["columns"]) => onChange({ ...data, columns });

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-1 text-sm font-semibold">Intro text</p>
        <Input
          value={data.blurb}
          placeholder="Short sentence under the logo"
          disabled={disabled}
          onChange={(event) => onChange({ ...data, blurb: event.target.value })}
        />
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Columns</p>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            className="gap-1.5"
            onClick={() => setColumns([...data.columns, { title: "New column", links: [] }])}
          >
            <Plus className="h-4 w-4" /> Add column
          </Button>
        </div>

        {data.columns.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No columns yet.
          </p>
        ) : null}

        {data.columns.map((column, index) => (
          <Row
            key={index}
            title={column.title || "Untitled"}
            disabled={disabled}
            onUp={() => setColumns(move(data.columns, index, -1))}
            onDown={() => setColumns(move(data.columns, index, 1))}
            onRemove={() => setColumns(data.columns.filter((_, i) => i !== index))}
          >
            <div className="space-y-3">
              <Input
                value={column.title}
                placeholder="Column heading"
                disabled={disabled}
                onChange={(event) =>
                  setColumns(
                    data.columns.map((c, i) =>
                      i === index ? { ...c, title: event.target.value } : c,
                    ),
                  )
                }
              />
              <div className="space-y-2 rounded-lg bg-muted/40 p-3">
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    className="gap-1.5"
                    onClick={() =>
                      setColumns(
                        data.columns.map((c, i) =>
                          i === index ? { ...c, links: [...c.links, { label: "", href: "" }] } : c,
                        ),
                      )
                    }
                  >
                    <Plus className="h-4 w-4" /> Add link
                  </Button>
                </div>
                {column.links.map((link, linkIndex) => (
                  <div key={linkIndex} className="flex items-start gap-2">
                    <div className="flex-1">
                      <LinkFields
                        link={link}
                        disabled={disabled}
                        onChange={(next) =>
                          setColumns(
                            data.columns.map((c, i) =>
                              i === index
                                ? {
                                    ...c,
                                    links: c.links.map((l, li) => (li === linkIndex ? next : l)),
                                  }
                                : c,
                            ),
                          )
                        }
                      />
                    </div>
                    <div className="flex flex-col">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={disabled}
                        onClick={() =>
                          setColumns(
                            data.columns.map((c, i) =>
                              i === index ? { ...c, links: move(c.links, linkIndex, -1) } : c,
                            ),
                          )
                        }
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={disabled}
                        onClick={() =>
                          setColumns(
                            data.columns.map((c, i) =>
                              i === index ? { ...c, links: move(c.links, linkIndex, 1) } : c,
                            ),
                          )
                        }
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={disabled}
                        onClick={() =>
                          setColumns(
                            data.columns.map((c, i) =>
                              i === index
                                ? { ...c, links: c.links.filter((_, li) => li !== linkIndex) }
                                : c,
                            ),
                          )
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
                {column.links.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No links in this column yet.</p>
                ) : null}
              </div>
            </div>
          </Row>
        ))}
      </section>
    </div>
  );
}

export function NavVisualEditor({ menuType, value, disabled, onChange }: Props) {
  if (menuType === "header") {
    return (
      <HeaderEditor
        data={looseHeader(value)}
        disabled={disabled}
        onChange={(next) => onChange(next)}
      />
    );
  }
  return (
    <FooterEditor
      data={looseFooter(value)}
      disabled={disabled}
      onChange={(next) => onChange(next)}
    />
  );
}
