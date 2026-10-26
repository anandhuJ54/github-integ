import { supabase } from "@v3/ui/integrations/supabase/client";
import { api } from "@v3/ui/lib/server-fn";
import type { Team } from "@v3/ops/lib/dev-progress";

/*
 * Build module wiki data layer — reads/writes exp_wiki_* (tables owned by the data architect)
 * through /ops/wiki/* (surface-api/ops/queries/wiki.py), as the signed-in user. The API sets
 * author / user_ref from the login (currentUserRef's value).
 */

export type WikiSpace = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  owner: string | null;
  team_key: string | null;
  icon: string | null;
  color: string | null;
  sort_order: number | null;
  is_archived: boolean | null;
  page_count?: number;
};

export type WikiDoc = {
  id: string;
  slug: string;
  title: string;
  category: string | null;
  tags: string[] | null;
  summary: string | null;
  body_md: string | null;
  status: string | null;
  author: string | null;
  is_pinned: boolean | null;
  sort_order: number | null;
  word_count: number | null;
  created_at: string;
  updated_at: string;
  space_id: string | null;
  parent_id: string | null;
};

export type TreeNode = WikiDoc & { children: TreeNode[] };
export type WikiComment = {
  id: string;
  doc_id: string;
  parent_id: string | null;
  author: string | null;
  body: string;
  resolved: boolean | null;
  created_at: string;
};
export type WikiRevision = {
  id: string;
  doc_id: string;
  title: string | null;
  category: string | null;
  summary: string | null;
  body_md: string | null;
  edited_by: string | null;
  created_at: string;
};

export async function currentUserRef(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  return data.user?.email ?? data.user?.id ?? "unknown";
}

export function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "page"
  );
}

/** Pure: nest docs by parent_id, ordered pinned desc, sort_order, title. */
export function buildTree(docs: WikiDoc[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  docs.forEach((d) => byId.set(d.id, { ...d, children: [] }));
  const roots: TreeNode[] = [];
  byId.forEach((n) => {
    const p = n.parent_id ? byId.get(n.parent_id) : undefined;
    if (p) p.children.push(n);
    else roots.push(n);
  });
  const sort = (arr: TreeNode[]) => {
    arr.sort(
      (a, b) =>
        Number(!!b.is_pinned) - Number(!!a.is_pinned) ||
        (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
        a.title.localeCompare(b.title),
    );
    arr.forEach((c) => sort(c.children));
  };
  sort(roots);
  return roots;
}

/** Map a space to its dev team: team_key → team id or name slug, else space key ↔ team name. */
export function teamForSpace(space: WikiSpace, teams: Team[]): Team | null {
  const k = (space.team_key ?? "").toLowerCase();
  if (k) {
    const t = teams.find((t) => t.id === k || slugify(t.name) === k);
    if (t) return t;
  }
  const words = space.key.toLowerCase().split("-");
  return (
    teams.find((t) => slugify(t.name) === space.key) ??
    teams.find((t) => {
      const parts = slugify(t.name).split("-");
      return words.every((w) => parts.includes(w));
    }) ??
    null
  );
}

/* ───────── Loaders ───────── */

export async function listSpaces(): Promise<WikiSpace[]> {
  const { spaces, docs } = await api.get<{ spaces: WikiSpace[]; docs: { space_id: string }[] }>(
    "/ops/wiki/spaces",
  );
  const counts = new Map<string, number>();
  for (const d of docs) counts.set(d.space_id, (counts.get(d.space_id) ?? 0) + 1);
  return spaces.map((s) => ({ ...s, page_count: counts.get(s.id) ?? 0 }));
}

export function getSpace(key: string): Promise<WikiSpace | null> {
  return api.get<WikiSpace | null>(`/ops/wiki/spaces/${encodeURIComponent(key)}`);
}

export async function spaceTree(spaceId: string): Promise<{ docs: WikiDoc[]; tree: TreeNode[] }> {
  const docs = await api.get<WikiDoc[]>(`/ops/wiki/spaces/${encodeURIComponent(spaceId)}/docs`);
  return { docs, tree: buildTree(docs) };
}

export function getDoc(spaceId: string, slug: string): Promise<WikiDoc | null> {
  return api.get<WikiDoc | null>("/ops/wiki/doc", { params: { space_id: spaceId, slug } });
}

export function docComments(docId: string): Promise<WikiComment[]> {
  return api.get<WikiComment[]>(`/ops/wiki/docs/${encodeURIComponent(docId)}/comments`);
}

export function docRevisions(docId: string): Promise<WikiRevision[]> {
  return api.get<WikiRevision[]>(`/ops/wiki/docs/${encodeURIComponent(docId)}/revisions`);
}

export type SearchHit = { id: string; slug: string; title: string; space_key: string | null; space_name: string | null; snippet: string };

export async function searchWiki(q: string): Promise<SearchHit[]> {
  if (!q.trim()) return [];
  const rows = await api.get<(WikiDoc & { exp_wiki_spaces: { key: string; name: string } | null })[]>(
    "/ops/wiki/search",
    { params: { q } },
  );
  const term = q.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return rows.map((r) => {
    const body = (r.body_md ?? "").replace(/[#*`>_[\]()-]/g, " ").replace(/\s+/g, " ");
    const i = term ? body.toLowerCase().indexOf(term) : -1;
    const snippet = r.summary || (i >= 0 ? `…${body.slice(Math.max(0, i - 60), i + 120)}…` : body.slice(0, 160));
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      space_key: r.exp_wiki_spaces?.key ?? null,
      space_name: r.exp_wiki_spaces?.name ?? null,
      snippet,
    };
  });
}

export function isWatching(target: { docId?: string; spaceId?: string }): Promise<boolean> {
  return api.get<boolean>("/ops/wiki/watching", {
    params: target.docId ? { doc_id: target.docId } : { space_id: target.spaceId },
  });
}

/* ───────── Mutations ───────── */

export function createDoc(input: { spaceId: string; parentId?: string | null; title: string }): Promise<WikiDoc> {
  // the API picks a free slug from the title, as this did
  return api.post<WikiDoc>("/ops/wiki/docs", {
    space_id: input.spaceId,
    parent_id: input.parentId ?? null,
    title: input.title,
  });
}

export async function updateDoc(
  id: string,
  patch: Partial<Pick<WikiDoc, "title" | "body_md" | "category" | "tags" | "summary" | "parent_id" | "is_pinned">>,
) {
  await api.patch(`/ops/wiki/docs/${encodeURIComponent(id)}`, patch);
}

export async function moveDoc(id: string, parentId: string | null) {
  if (parentId === id) throw new Error("A page can't be its own parent");
  await updateDoc(id, { parent_id: parentId });
}

export async function pinDoc(id: string, pinned: boolean) {
  await updateDoc(id, { is_pinned: pinned });
}

export async function addComment(docId: string, body: string, parentId?: string | null) {
  await api.post(`/ops/wiki/docs/${encodeURIComponent(docId)}/comments`, { body, parent_id: parentId ?? null });
}

export async function resolveComment(id: string, resolved = true) {
  await api.patch(`/ops/wiki/comments/${encodeURIComponent(id)}`, { resolved });
}

export function toggleWatch(target: { docId?: string; spaceId?: string }): Promise<boolean> {
  // watching after the toggle
  return api.post<boolean>("/ops/wiki/watch", {
    doc_id: target.docId ?? null,
    space_id: target.spaceId ?? null,
  });
}
