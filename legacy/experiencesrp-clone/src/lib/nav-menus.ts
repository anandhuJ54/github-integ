import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

/* ───────────── Types ───────────── */

export type NavMenuType = "header" | "footer";

export type NavLink = { label: string; href: string; blurb?: string };
export type NavGroup = {
  kind: "menu" | "link";
  label: string;
  href?: string;
  wide?: boolean;
  items?: NavLink[];
};
export type NavAction = { label: string; href: string; style?: "primary" | "text" };

export type HeaderNavData = { groups: NavGroup[]; actions: NavAction[] };
export type FooterNavData = { blurb: string; columns: { title: string; links: NavLink[] }[] };

export type NavMenu = {
  id: string;
  name: string;
  menu_type: NavMenuType;
  items: Json;
  assigned_site: string | null;
  design_tag: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
};

/** Sites a navigation can be assigned to. Only the main website is live today. */
export const NAV_SITES: { key: string; label: string; live: boolean }[] = [
  { key: "main_site", label: "Main website", live: true },
];

export function siteLabel(key: string | null): string {
  if (!key) return "Unassigned";
  return NAV_SITES.find((s) => s.key === key)?.label ?? key;
}

/* ───────────── Normalizers (never trust stored JSON shape) ───────────── */

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function linkList(value: unknown): NavLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      const link: NavLink = { label: str(item['label']), href: str(item['href']) };
      const blurb = str(item['blurb']);
      if (blurb) link.blurb = blurb;
      return link;
    })
    .filter((l) => l.label && l.href);
}

export function normalizeHeader(value: unknown): HeaderNavData {
  const root = (value ?? {}) as Record<string, unknown>;
  const groups = Array.isArray(root['groups']) ? (root['groups'] as unknown[]) : [];
  const actions = Array.isArray(root['actions']) ? (root['actions'] as unknown[]) : [];
  return {
    groups: groups
      .map((raw) => {
        const g = (raw ?? {}) as Record<string, unknown>;
        const items = linkList(g['items']);
        const kind = g['kind'] === "link" || (!items.length && g['href']) ? "link" : "menu";
        const group: NavGroup = { kind, label: str(g['label']) };
        if (g['href']) group.href = str(g['href']);
        if (g['wide'] === true) group.wide = true;
        if (items.length) group.items = items;
        return group;
      })
      .filter((g) => g.label && (g.kind === "menu" ? (g.items?.length ?? 0) > 0 : !!g.href)),
    actions: actions
      .map((raw) => {
        const a = (raw ?? {}) as Record<string, unknown>;
        return {
          label: str(a['label']),
          href: str(a['href']),
          style: a['style'] === "primary" ? ("primary" as const) : ("text" as const),
        };
      })
      .filter((a) => a.label && a.href),
  };
}

export function normalizeFooter(value: unknown): FooterNavData {
  const root = (value ?? {}) as Record<string, unknown>;
  const columns = Array.isArray(root['columns']) ? (root['columns'] as unknown[]) : [];
  return {
    blurb: str(root['blurb']),
    columns: columns
      .map((raw) => {
        const c = (raw ?? {}) as Record<string, unknown>;
        return { title: str(c['title']), links: linkList(c['links']) };
      })
      .filter((c) => c.title && c.links.length),
  };
}

/** Link count used in the admin list. */
export function navLinkCount(menu: NavMenu): number {
  if (menu.menu_type === "header") {
    const data = normalizeHeader(menu.items);
    return (
      data.groups.reduce((n, g) => n + (g.kind === "menu" ? (g.items?.length ?? 0) : 1), 0) +
      data.actions.length
    );
  }
  return normalizeFooter(menu.items).columns.reduce((n, c) => n + c.links.length, 0);
}

/* ───────────── Reads ───────────── */

const COLUMNS =
  "id, name, menu_type, items, assigned_site, design_tag, notes, created_at, updated_at, deleted_at, deleted_by";

export async function loadNavMenus(): Promise<NavMenu[]> {
  const { data, error } = await supabase
    .from("exp_web_nav_menus")
    .select(COLUMNS)
    .is("deleted_at", null)
    .order("menu_type", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as NavMenu[];
}

export async function loadDeletedNavMenus(): Promise<NavMenu[]> {
  const { data, error } = await supabase
    .from("exp_web_nav_menus")
    .select(COLUMNS)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as NavMenu[];
}

/** Public read: the navigation assigned to a site (used by the live site chrome). */
export async function loadAssignedNav(site = "main_site") {
  const { data, error } = await supabase
    .from("exp_web_nav_menus")
    .select("id, menu_type, items")
    .eq("assigned_site", site)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { menu_type: string; items: Json }[];
  const header = rows.find((r) => r.menu_type === "header");
  const footer = rows.find((r) => r.menu_type === "footer");
  return {
    header: header ? normalizeHeader(header.items) : null,
    footer: footer ? normalizeFooter(footer.items) : null,
  };
}

/* ───────────── Writes ───────────── */

function starterItems(type: NavMenuType): Json {
  return (type === "header"
    ? { groups: [], actions: [] }
    : { blurb: "", columns: [] }) as unknown as Json;
}

export const navMutations = {
  async create(input: { name: string; menu_type: NavMenuType; items?: Json; notes?: string }) {
    const { data, error } = await supabase
      .from("exp_web_nav_menus")
      .insert({
        name: input.name,
        menu_type: input.menu_type,
        items: input.items ?? starterItems(input.menu_type),
        notes: input.notes ?? null,
        design_tag: "new",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id as string;
  },

  async update(id: string, patch: { name?: string; items?: Json; notes?: string | null }) {
    const { error } = await supabase.from("exp_web_nav_menus").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
  },

  async duplicate(id: string) {
    const { data, error } = await supabase
      .from("exp_web_nav_menus")
      .select("name, menu_type, items, notes")
      .eq("id", id)
      .single();
    if (error) throw new Error(error.message);
    return navMutations.create({
      name: `${data.name} (copy)`,
      menu_type: data.menu_type as NavMenuType,
      items: data.items,
      notes: data.notes ?? undefined,
    });
  },

  /** Assign to a site (unassigns whatever menu of the same type held the slot) or clear with null. */
  async setAssignment(id: string, menuType: NavMenuType, site: string | null) {
    if (site) {
      const { error: clearError } = await supabase
        .from("exp_web_nav_menus")
        .update({ assigned_site: null })
        .eq("assigned_site", site)
        .eq("menu_type", menuType)
        .neq("id", id);
      if (clearError) throw new Error(clearError.message);
    }
    const { error } = await supabase
      .from("exp_web_nav_menus")
      .update({ assigned_site: site })
      .eq("id", id);
    if (error) throw new Error(error.message);
  },

  async softDelete(id: string, userId: string | null) {
    const { error } = await supabase
      .from("exp_web_nav_menus")
      .update({ deleted_at: new Date().toISOString(), deleted_by: userId, assigned_site: null })
      .eq("id", id);
    if (error) throw new Error(error.message);
  },

  async restore(id: string) {
    const { error } = await supabase
      .from("exp_web_nav_menus")
      .update({ deleted_at: null, deleted_by: null })
      .eq("id", id);
    if (error) throw new Error(error.message);
  },

  async hardDelete(id: string) {
    const { error } = await supabase.from("exp_web_nav_menus").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },
};
