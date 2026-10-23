import { createFileRoute, Link, Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronDown, ChevronRight, FileText, Pin } from "lucide-react";
import { EmptyState, PageBody } from "@/components/console/primitives";
import { WikiSearch, accentOf, useSpaceData } from "@/components/build/wiki-bits";
import type { TreeNode } from "@/lib/build-wiki";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/build/spaces/$spaceKey")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.spaceKey} space — Build wiki` },
      { name: "description", content: "Space pages, page tree and lane delivery." },
      { property: "og:title", content: `${params.spaceKey} space — Build wiki` },
      { property: "og:description", content: "Space pages, page tree and lane delivery." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SpaceLayout,
});

function TreeItem({ node, spaceKey, active, depth }: { node: TreeNode; spaceKey: string; active?: string; depth: number }) {
  const [open, setOpen] = useState(true);
  return (
    <li>
      <div
        className={cn(
          "flex items-center gap-1 rounded-md py-1 pr-2 text-[13px]",
          active === node.slug ? "bg-[color:var(--color-surface-2)] font-semibold text-ink" : "text-[color:var(--color-ink-2)] hover:bg-[color:var(--color-surface-2)]",
        )}
        style={{ paddingLeft: 4 + depth * 12 }}
      >
        {node.children.length ? (
          <button type="button" onClick={() => setOpen((o) => !o)} aria-label={open ? "Collapse" : "Expand"} className="shrink-0">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <FileText className="h-3.5 w-3.5 shrink-0 opacity-50" />
        )}
        <Link to="/build/spaces/$spaceKey/$slug" params={{ spaceKey, slug: node.slug }} className="min-w-0 flex-1 truncate">
          {node.title}
        </Link>
        {node.is_pinned ? <Pin className="h-3 w-3 shrink-0 opacity-60" /> : null}
      </div>
      {open && node.children.length ? (
        <ul>
          {node.children.map((c) => (
            <TreeItem key={c.id} node={c} spaceKey={spaceKey} active={active} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function SpaceLayout() {
  const { spaceKey } = Route.useParams();
  const params = useParams({ strict: false }) as { slug?: string };
  const navigate = useNavigate();
  const { space, tree } = useSpaceData(spaceKey);

  if (space.isLoading) return <PageBody><p className="text-sm text-[color:var(--color-ink-3)]">Loading…</p></PageBody>;
  if (!space.data)
    return (
      <PageBody>
        <EmptyState
          title="Space not found"
          description={space.error ? (space.error as Error).message : `No space with key “${spaceKey}”.`}
          action={<button type="button" className="text-sm text-[color:var(--color-g-blue)]" onClick={() => navigate({ to: "/build/spaces" })}>Back to spaces</button>}
        />
      </PageBody>
    );

  return (
    <div className="mx-auto flex w-full max-w-[1400px] gap-6 px-8 py-6">
      <aside className="hidden w-64 shrink-0 md:block">
        <Link to="/build/spaces/$spaceKey" params={{ spaceKey }} className="mb-3 flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm" style={{ background: accentOf(space.data.color) }} />
          <span className="truncate text-sm font-semibold text-ink">{space.data.name}</span>
        </Link>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[color:var(--color-ink-3)]">Pages</p>
        {tree.isLoading ? (
          <p className="text-xs text-[color:var(--color-ink-3)]">Loading…</p>
        ) : !tree.data?.tree.length ? (
          <p className="text-xs text-[color:var(--color-ink-3)]">No pages yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {tree.data.tree.map((n) => (
              <TreeItem key={n.id} node={n} spaceKey={spaceKey} active={params.slug} depth={0} />
            ))}
          </ul>
        )}
      </aside>
      <main className="min-w-0 flex-1">
        <div className="mb-5 flex justify-end">
          <WikiSearch />
        </div>
        <Outlet />
      </main>
    </div>
  );
}
