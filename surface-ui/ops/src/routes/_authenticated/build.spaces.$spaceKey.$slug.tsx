import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Check, Eye, EyeOff, History, Pencil, Pin, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@v3/shared/components/ui/button";
import { Input } from "@v3/shared/components/ui/input";
import { Textarea } from "@v3/shared/components/ui/textarea";
import { EmptyState, Panel } from "@v3/shared/components/ui/console-primitives";
import { Markdown, useSpaceData } from "@v3/ops/components/build/wiki-bits";
import {
  addComment,
  createDoc,
  docComments,
  docRevisions,
  getDoc,
  isWatching,
  moveDoc,
  pinDoc,
  resolveComment,
  toggleWatch,
  updateDoc,
  type WikiComment,
  type WikiDoc,
} from "@v3/ops/utils/build-wiki";

export const Route = createFileRoute("/_authenticated/build/spaces/$spaceKey/$slug")({
  validateSearch: (s: Record<string, unknown>): { edit?: boolean } => (s.edit ? { edit: true } : {}),
  head: ({ params }) => ({
    meta: [
      { title: `${params.slug} — Build wiki` },
      { name: "description", content: "Wiki page with comments and version history." },
      { property: "og:title", content: `${params.slug} — Build wiki` },
      { property: "og:description", content: "Wiki page with comments and version history." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DocPage,
});

function DocPage() {
  const { spaceKey, slug } = Route.useParams();
  const { edit } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { space, tree } = useSpaceData(spaceKey);
  const spaceId = space.data?.id;
  const doc = useQuery({
    queryKey: ["wiki-doc", spaceId, slug],
    queryFn: () => getDoc(spaceId!, slug),
    enabled: !!spaceId,
  });
  const [showHistory, setShowHistory] = useState(false);
  const d = doc.data;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["wiki-doc", spaceId] });
    qc.invalidateQueries({ queryKey: ["wiki-tree", spaceId] });
    qc.invalidateQueries({ queryKey: ["wiki-revisions", d?.id] });
  };

  const crumbs = useMemo(() => {
    if (!d) return [];
    const byId = new Map((tree.data?.docs ?? []).map((x) => [x.id, x]));
    const out: WikiDoc[] = [];
    let p = d.parent_id ? byId.get(d.parent_id) : undefined;
    while (p && out.length < 20) {
      out.unshift(p);
      p = p.parent_id ? byId.get(p.parent_id) : undefined;
    }
    return out;
  }, [d, tree.data]);

  const createChild = useMutation({
    mutationFn: (title: string) => createDoc({ spaceId: spaceId!, parentId: d!.id, title }),
    onSuccess: (nd) => {
      refresh();
      navigate({ to: "/build/spaces/$spaceKey/$slug", params: { spaceKey, slug: nd.slug }, search: { edit: true } });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const pin = useMutation({
    mutationFn: () => pinDoc(d!.id, !d!.is_pinned),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  if (doc.isLoading || space.isLoading) return <p className="text-sm text-[color:var(--color-ink-3)]">Loading…</p>;
  if (!d) return <EmptyState title="Page not found" description={doc.error ? (doc.error as Error).message : `No page “${slug}” in this space.`} />;

  return (
    <div className="flex flex-col gap-6 xl:flex-row">
      <article className="min-w-0 flex-1">
        <nav className="mb-2 flex flex-wrap items-center gap-1 text-xs text-[color:var(--color-ink-3)]">
          <Link to="/build/spaces/$spaceKey" params={{ spaceKey }} className="hover:text-ink">{space.data?.name}</Link>
          {crumbs.map((c) => (
            <span key={c.id} className="flex items-center gap-1">
              ›<Link to="/build/spaces/$spaceKey/$slug" params={{ spaceKey, slug: c.slug }} className="hover:text-ink">{c.title}</Link>
            </span>
          ))}
          <span>› {d.title}</span>
        </nav>

        {edit ? (
          <Editor
            doc={d}
            siblings={tree.data?.docs ?? []}
            onDone={(newSlug) => {
              refresh();
              navigate({ to: "/build/spaces/$spaceKey/$slug", params: { spaceKey, slug: newSlug ?? slug }, search: {} });
            }}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-start gap-3">
              <h1 className="min-w-0 flex-1 text-[26px] font-semibold leading-tight text-ink">{d.title}</h1>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => pin.mutate()} disabled={pin.isPending}>
                  <Pin className="mr-1.5 h-4 w-4" />
                  {d.is_pinned ? "Unpin" : "Pin"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowHistory((v) => !v)}>
                  <History className="mr-1.5 h-4 w-4" />
                  History
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={createChild.isPending}
                  onClick={() => {
                    const t = window.prompt("Child page title");
                    if (t?.trim()) createChild.mutate(t.trim());
                  }}
                >
                  <Plus className="mr-1.5 h-4 w-4" />
                  New child page
                </Button>
                <Button size="sm" onClick={() => navigate({ to: "/build/spaces/$spaceKey/$slug", params: { spaceKey, slug }, search: { edit: true } })}>
                  <Pencil className="mr-1.5 h-4 w-4" />
                  Edit
                </Button>
              </div>
            </div>
            <p className="mt-2 text-xs text-[color:var(--color-ink-3)]">
              Updated {new Date(d.updated_at).toLocaleString()} · {d.author ?? "—"} · {d.category ?? "Uncategorized"} ·{" "}
              <span className="tabular-nums">{d.word_count ?? 0}</span> words
            </p>
            {d.tags?.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {d.tags.map((t) => (
                  <span key={t} className="rounded-md bg-[color:var(--color-surface-2)] px-2 py-0.5 text-[11px] text-[color:var(--color-ink-2)]">{t}</span>
                ))}
              </div>
            ) : null}
            {showHistory ? <Revisions docId={d.id} onRestored={refresh} /> : null}
            <div className="mt-6 rounded-[16px] border border-[color:var(--color-hairline)] bg-card p-6">
              <Markdown source={d.body_md ?? ""} />
            </div>
          </>
        )}
      </article>
      <aside className="w-full shrink-0 space-y-4 xl:w-80">
        <WatchToggle docId={d.id} />
        <Comments docId={d.id} />
      </aside>
    </div>
  );
}

function Editor({ doc, siblings, onDone }: { doc: WikiDoc; siblings: WikiDoc[]; onDone: (slug?: string) => void }) {
  const [title, setTitle] = useState(doc.title);
  const [body, setBody] = useState(doc.body_md ?? "");
  const [category, setCategory] = useState(doc.category ?? "");
  const [tags, setTags] = useState((doc.tags ?? []).join(", "));
  const [parent, setParent] = useState(doc.parent_id ?? "");
  const [pinned, setPinned] = useState(!!doc.is_pinned);
  useEffect(() => {
    setTitle(doc.title);
    setBody(doc.body_md ?? "");
  }, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Exclude self and descendants from parent options.
  const blocked = useMemo(() => {
    const set = new Set([doc.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const s of siblings) if (s.parent_id && set.has(s.parent_id) && !set.has(s.id)) { set.add(s.id); grew = true; }
    }
    return set;
  }, [doc.id, siblings]);

  const save = useMutation({
    mutationFn: async () => {
      await updateDoc(doc.id, {
        title: title.trim() || doc.title,
        body_md: body,
        category: category.trim() || null,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        is_pinned: pinned,
      });
      if ((parent || null) !== doc.parent_id) await moveDoc(doc.id, parent || null);
    },
    onSuccess: () => {
      toast.success("Page saved");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mb-3 text-lg font-semibold" aria-label="Title" />
      <div className="mb-3 grid gap-2 sm:grid-cols-4">
        <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category" aria-label="Category" />
        <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags, comma separated" aria-label="Tags" />
        <select value={parent} onChange={(e) => setParent(e.target.value)} aria-label="Parent page" className="h-9 rounded-md border border-input bg-background px-2 text-sm">
          <option value="">Top level</option>
          {siblings.filter((s) => !blocked.has(s.id)).map((s) => (
            <option key={s.id} value={s.id}>{s.title}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pinned
        </label>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={24} className="font-mono text-xs" placeholder="Write in Markdown…" aria-label="Body" />
        <div className="max-h-[560px] overflow-y-auto rounded-[12px] border border-[color:var(--color-hairline)] bg-card p-4">
          <Markdown source={body} />
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
        <Button variant="outline" onClick={() => onDone()}>Cancel</Button>
      </div>
    </div>
  );
}

function Revisions({ docId, onRestored }: { docId: string; onRestored: () => void }) {
  const revs = useQuery({ queryKey: ["wiki-revisions", docId], queryFn: () => docRevisions(docId) });
  const restore = useMutation({
    mutationFn: (r: { title: string | null; body_md: string | null }) =>
      updateDoc(docId, { ...(r.title ? { title: r.title } : {}), body_md: r.body_md ?? "" }),
    onSuccess: () => {
      toast.success("Revision restored");
      onRestored();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Panel className="mt-4" title="Version history">
      {revs.isLoading ? (
        <p className="text-xs text-[color:var(--color-ink-3)]">Loading…</p>
      ) : !revs.data?.length ? (
        <p className="text-xs text-[color:var(--color-ink-3)]">No earlier versions yet.</p>
      ) : (
        <ul className="divide-y divide-[color:var(--color-hairline)]">
          {revs.data.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-xs">
              <span className="min-w-0 truncate">
                <span className="font-medium text-ink">{new Date(r.created_at).toLocaleString()}</span>
                <span className="text-[color:var(--color-ink-3)]"> · {r.edited_by ?? "—"} · {r.title}</span>
              </span>
              <Button size="sm" variant="outline" disabled={restore.isPending} onClick={() => window.confirm("Restore this version?") && restore.mutate(r)}>
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function WatchToggle({ docId }: { docId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["wiki-watch", "doc", docId], queryFn: () => isWatching({ docId }) });
  const m = useMutation({
    mutationFn: () => toggleWatch({ docId }),
    onSuccess: (on) => {
      qc.invalidateQueries({ queryKey: ["wiki-watch", "doc", docId] });
      toast.success(on ? "Watching this page" : "Stopped watching");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Button variant="outline" className="w-full" onClick={() => m.mutate()} disabled={m.isPending}>
      {q.data ? <EyeOff className="mr-1.5 h-4 w-4" /> : <Eye className="mr-1.5 h-4 w-4" />}
      {q.data ? "Unwatch page" : "Watch page"}
    </Button>
  );
}

function Comments({ docId }: { docId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["wiki-comments", docId], queryFn: () => docComments(docId) });
  const [text, setText] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["wiki-comments", docId] });
  const add = useMutation({
    mutationFn: (v: { body: string; parentId?: string }) => addComment(docId, v.body, v.parentId),
    onSuccess: () => {
      setText("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const resolve = useMutation({
    mutationFn: (c: WikiComment) => resolveComment(c.id, !c.resolved),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });
  const all = q.data ?? [];
  const roots = all.filter((c) => !c.parent_id);

  const Item = ({ c, depth }: { c: WikiComment; depth: number }) => {
    const [reply, setReply] = useState("");
    const [open, setOpen] = useState(false);
    const kids = all.filter((k) => k.parent_id === c.id);
    return (
      <li className={depth ? "ml-3 border-l border-[color:var(--color-hairline)] pl-3" : ""}>
        <div className={c.resolved ? "opacity-60" : ""}>
          <p className="text-[11px] text-[color:var(--color-ink-3)]">
            {c.author ?? "—"} · {new Date(c.created_at).toLocaleDateString()}
            {c.resolved ? " · Resolved" : ""}
          </p>
          <p className="whitespace-pre-wrap text-sm text-ink">{c.body}</p>
          <div className="mt-1 flex gap-3 text-[11px]">
            <button type="button" className="text-[color:var(--color-g-blue)]" onClick={() => setOpen((o) => !o)}>Reply</button>
            {!depth ? (
              <button type="button" className="flex items-center gap-0.5 text-[color:var(--color-ink-2)]" onClick={() => resolve.mutate(c)}>
                <Check className="h-3 w-3" />
                {c.resolved ? "Reopen" : "Resolve"}
              </button>
            ) : null}
          </div>
          {open ? (
            <form
              className="mt-1.5 flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (reply.trim()) add.mutate({ body: reply.trim(), parentId: c.id });
                setReply("");
                setOpen(false);
              }}
            >
              <Input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply…" className="h-8 text-xs" />
              <Button size="sm" type="submit">Send</Button>
            </form>
          ) : null}
        </div>
        {kids.length ? (
          <ul className="mt-2 space-y-2">
            {kids.map((k) => <Item key={k.id} c={k} depth={depth + 1} />)}
          </ul>
        ) : null}
      </li>
    );
  };

  return (
    <Panel title={`Comments${all.length ? ` (${all.length})` : ""}`}>
      {q.isLoading ? (
        <p className="text-xs text-[color:var(--color-ink-3)]">Loading…</p>
      ) : !roots.length ? (
        <p className="text-xs text-[color:var(--color-ink-3)]">No comments yet.</p>
      ) : (
        <ul className="space-y-3">
          {roots.map((c) => <Item key={c.id} c={c} depth={0} />)}
        </ul>
      )}
      <form
        className="mt-3 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) add.mutate({ body: text.trim() });
        }}
      >
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Add a comment…" />
        <Button size="sm" type="submit" disabled={add.isPending || !text.trim()}>Comment</Button>
      </form>
    </Panel>
  );
}
