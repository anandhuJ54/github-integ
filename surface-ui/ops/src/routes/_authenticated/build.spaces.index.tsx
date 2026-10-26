import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BookOpen } from "lucide-react";
import { EmptyState, PageBody, PageHeader } from "@v3/shared/components/ui/console-primitives";
import { WikiSearch, accentOf } from "@v3/ops/components/build/wiki-bits";
import { listSpaces } from "@v3/ops/utils/build-wiki";

export const Route = createFileRoute("/_authenticated/build/spaces/")({
  head: () => ({
    meta: [
      { title: "Spaces — Build wiki" },
      { name: "description", content: "Knowledge spaces for every lane of the platform." },
      { property: "og:title", content: "Spaces — Build wiki" },
      { property: "og:description", content: "Knowledge spaces for every lane of the platform." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SpacesPage,
});

function SpacesPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ["wiki-spaces"], queryFn: listSpaces });
  return (
    <PageBody>
      <PageHeader eyebrow="Build" title="Spaces" description="One space per lane, owned by its surface owner." actions={<WikiSearch />} />
      {error ? (
        <EmptyState title="Couldn't load spaces" description={(error as Error).message} />
      ) : isLoading ? (
        <p className="text-sm text-[color:var(--color-ink-3)]">Loading…</p>
      ) : !data?.length ? (
        <EmptyState title="No spaces yet" description="Spaces appear here once they're created." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {data.map((s) => (
            <Link
              key={s.id}
              to="/build/spaces/$spaceKey"
              params={{ spaceKey: s.key }}
              className="relative overflow-hidden rounded-[16px] border border-[color:var(--color-hairline)] bg-card p-5 shadow-[var(--shadow-xs)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]"
            >
              <span className="absolute inset-x-0 top-0 h-1" style={{ background: accentOf(s.color) }} />
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-lg text-primary-foreground" style={{ background: accentOf(s.color) }}>
                  <BookOpen className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{s.name}</p>
                  <p className="text-[11px] text-[color:var(--color-ink-3)]">{s.owner ? `Owner: ${s.owner}` : "No owner"}</p>
                </div>
              </div>
              <p className="mt-3 line-clamp-3 min-h-[3.5em] text-xs text-[color:var(--color-ink-2)]">{s.description ?? "—"}</p>
              <p className="mt-3 text-xs font-semibold tabular-nums text-ink">
                {s.page_count} {s.page_count === 1 ? "page" : "pages"}
              </p>
            </Link>
          ))}
        </div>
      )}
    </PageBody>
  );
}
