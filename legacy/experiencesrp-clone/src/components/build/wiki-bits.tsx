import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { getSpace, searchWiki, spaceTree } from "@/lib/build-wiki";

export function Markdown({ source }: { source: string }) {
  if (!source.trim()) return <p className="text-sm italic text-[color:var(--color-ink-3)]">This page is empty.</p>;
  return (
    <div className="max-w-none text-sm leading-relaxed text-ink [&_a]:text-[color:var(--color-g-blue)] [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-[color:var(--color-hairline)] [&_blockquote]:pl-3 [&_blockquote]:italic [&_code]:rounded [&_code]:bg-[color:var(--color-surface-2)] [&_code]:px-1 [&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold [&_hr]:my-6 [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-[color:var(--color-surface-2)] [&_pre]:p-3 [&_table]:my-3 [&_table]:w-full [&_table]:text-left [&_td]:border [&_td]:border-[color:var(--color-hairline)] [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-[color:var(--color-hairline)] [&_th]:bg-[color:var(--color-surface-2)] [&_th]:px-2 [&_th]:py-1 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>
    </div>
  );
}

export function WikiSearch() {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const { data, isFetching, error } = useQuery({
    queryKey: ["wiki-search", term],
    queryFn: () => searchWiki(term),
    enabled: term.trim().length > 1,
  });
  return (
    <div className="relative w-full max-w-md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setTerm(q);
        }}
        className="relative"
      >
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[color:var(--color-ink-3)]" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the wiki…" className="pl-8" />
      </form>
      {term.trim().length > 1 ? (
        <div className="absolute z-20 mt-1 max-h-96 w-full overflow-y-auto rounded-lg border border-[color:var(--color-hairline)] bg-card p-1 shadow-[var(--shadow-md)]">
          {isFetching ? (
            <p className="p-3 text-xs text-[color:var(--color-ink-3)]">Searching…</p>
          ) : error ? (
            <p className="p-3 text-xs text-destructive">{(error as Error).message}</p>
          ) : !data?.length ? (
            <p className="p-3 text-xs text-[color:var(--color-ink-3)]">No pages match “{term}”.</p>
          ) : (
            data.map((h) =>
              h.space_key ? (
                <Link
                  key={h.id}
                  to="/build/spaces/$spaceKey/$slug"
                  params={{ spaceKey: h.space_key, slug: h.slug }}
                  onClick={() => setTerm("")}
                  className="block rounded-md p-2 hover:bg-[color:var(--color-surface-2)]"
                >
                  <p className="text-sm font-medium text-ink">{h.title}</p>
                  <p className="text-[11px] text-[color:var(--color-ink-3)]">{h.space_name}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-[color:var(--color-ink-2)]">{h.snippet}</p>
                </Link>
              ) : (
                <div key={h.id} className="p-2">
                  <p className="text-sm font-medium text-ink">{h.title}</p>
                  <p className="line-clamp-2 text-xs text-[color:var(--color-ink-2)]">{h.snippet}</p>
                </div>
              ),
            )
          )}
          <button type="button" onClick={() => setTerm("")} className="w-full p-1.5 text-center text-[11px] text-[color:var(--color-ink-3)] hover:text-ink">
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}

export const SPACE_ACCENT: Record<string, string> = {
  violet: "#8a5cf6",
  blue: "#2f6bff",
  teal: "#0ea5a4",
  amber: "#c07a12",
  green: "#12b76a",
  coral: "#e0533d",
  slate: "#243b57",
};
export const accentOf = (c: string | null) => (c && (SPACE_ACCENT[c] ?? (c.startsWith("#") ? c : null))) || "#243b57";

export function useSpaceData(spaceKey: string) {
  const space = useQuery({ queryKey: ["wiki-space", spaceKey], queryFn: () => getSpace(spaceKey) });
  const tree = useQuery({
    queryKey: ["wiki-tree", space.data?.id],
    queryFn: () => spaceTree(space.data!.id),
    enabled: !!space.data?.id,
  });
  return { space, tree };
}
