import { supabase } from "@v3/ui/integrations/supabase/client";
import type { Team } from "@v3/ops/lib/dev-progress";

/* Build module wiki data layer — reads/writes exp_wiki_* (tables owned by the data architect). */

// exp_wiki_* may not be in generated types yet; use an untyped handle.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

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

const DOC_LIST_COLS =
  "id,slug,title,category,tags,summary,status,author,is_pinned,sort_order,word_count,created_at,updated_at,space_id,parent_id";

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

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
  const [spaces, docs] = await Promise.all([
    db.from("exp_wiki_spaces").select("*").eq("is_archived", false).order("sort_order").order("name"),
    db.from("exp_wiki_docs").select("space_id").not("space_id", "is", null),
  ]);
  const counts = new Map<string, number>();
  for (const d of must<{ space_id: string }[]>(docs) ?? []) counts.set(d.space_id, (counts.get(d.space_id) ?? 0) + 1);
  return (must<WikiSpace[]>(spaces) ?? []).map((s) => ({ ...s, page_count: counts.get(s.id) ?? 0 }));
}

export async function getSpace(key: string): Promise<WikiSpace | null> {
  return must<WikiSpace | null>(await db.from("exp_wiki_spaces").select("*").eq("key", key).maybeSingle());
}

export async function spaceTree(spaceId: string): Promise<{ docs: WikiDoc[]; tree: TreeNode[] }> {
  const docs = must<WikiDoc[]>(await db.from("exp_wiki_docs").select(DOC_LIST_COLS).eq("space_id", spaceId)) ?? [];
  return { docs, tree: buildTree(docs) };
}

export async function getDoc(spaceId: string, slug: string): Promise<WikiDoc | null> {
  return must<WikiDoc | null>(
    await db.from("exp_wiki_docs").select("*").eq("space_id", spaceId).eq("slug", slug).maybeSingle(),
  );
}

export async function docComments(docId: string): Promise<WikiComment[]> {
  return must<WikiComment[]>(await db.from("exp_wiki_comments").select("*").eq("doc_id", docId).order("created_at")) ?? [];
}

export async function docRevisions(docId: string): Promise<WikiRevision[]> {
  return (
    must<WikiRevision[]>(
      await db.from("exp_wiki_revisions").select("*").eq("doc_id", docId).order("created_at", { ascending: false }),
    ) ?? []
  );
}

export type SearchHit = { id: string; slug: string; title: string; space_key: string | null; space_name: string | null; snippet: string };

export async function searchWiki(q: string): Promise<SearchHit[]> {
  if (!q.trim()) return [];
  const rows =
    must<(WikiDoc & { exp_wiki_spaces: { key: string; name: string } | null })[]>(
      await db
        .from("exp_wiki_docs")
        .select("id,slug,title,summary,body_md,exp_wiki_spaces(key,name)")
        .textSearch("search_tsv", q, { type: "websearch" })
        .limit(20),
    ) ?? [];
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

export async function isWatching(target: { docId?: string; spaceId?: string }): Promise<boolean> {
  const me = await currentUserRef();
  let q = db.from("exp_wiki_watchers").select("id").eq("user_ref", me);
  q = target.docId ? q.eq("doc_id", target.docId) : q.eq("space_id", target.spaceId);
  return (must<{ id: string }[]>(await q.limit(1)) ?? []).length > 0;
}

/* ───────── Mutations ───────── */

export async function createDoc(input: { spaceId: string; parentId?: string | null; title: string }): Promise<WikiDoc> {
  const author = await currentUserRef();
  const base = slugify(input.title);
  const existing = must<{ slug: string }[]>(await db.from("exp_wiki_docs").select("slug").like("slug", `${base}%`)) ?? [];
  const taken = new Set(existing.map((e) => e.slug));
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  return must<WikiDoc>(
    await db
      .from("exp_wiki_docs")
      .insert({
        slug,
        title: input.title,
        space_id: input.spaceId,
        parent_id: input.parentId ?? null,
        body_md: "",
        author,
        status: "draft",
      })
      .select("*")
      .single(),
  );
}

export async function updateDoc(
  id: string,
  patch: Partial<Pick<WikiDoc, "title" | "body_md" | "category" | "tags" | "summary" | "parent_id" | "is_pinned">>,
) {
  must(await db.from("exp_wiki_docs").update(patch).eq("id", id).select("id"));
}

export async function moveDoc(id: string, parentId: string | null) {
  if (parentId === id) throw new Error("A page can't be its own parent");
  await updateDoc(id, { parent_id: parentId });
}

export async function pinDoc(id: string, pinned: boolean) {
  await updateDoc(id, { is_pinned: pinned });
}

export async function addComment(docId: string, body: string, parentId?: string | null) {
  const author = await currentUserRef();
  must(await db.from("exp_wiki_comments").insert({ doc_id: docId, body, parent_id: parentId ?? null, author }).select("id"));
}

export async function resolveComment(id: string, resolved = true) {
  must(await db.from("exp_wiki_comments").update({ resolved }).eq("id", id).select("id"));
}

export async function toggleWatch(target: { docId?: string; spaceId?: string }): Promise<boolean> {
  const me = await currentUserRef();
  let q = db.from("exp_wiki_watchers").select("id").eq("user_ref", me);
  q = target.docId ? q.eq("doc_id", target.docId) : q.eq("space_id", target.spaceId);
  const rows = must<{ id: string }[]>(await q) ?? [];
  if (rows.length) {
    must(await db.from("exp_wiki_watchers").delete().in("id", rows.map((r) => r.id)).select("id"));
    return false;
  }
  must(
    await db
      .from("exp_wiki_watchers")
      .insert({ user_ref: me, doc_id: target.docId ?? null, space_id: target.spaceId ?? null })
      .select("id"),
  );
  return true;
}
