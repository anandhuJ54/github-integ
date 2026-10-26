import { Link } from "@tanstack/react-router";
import { Newspaper } from "lucide-react";
import { hubPath, prettyTopic, type VoceArticle } from "@v3/shared/public/utils/voce";

/** Labeled "Featured article" unit for the SERP — never styled as an entity result. */
export function FeaturedArticleUnit({ article }: { article: VoceArticle }) {
  return (
    <article className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
      <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wide text-amber-800 uppercase">
        <Newspaper className="h-3.5 w-3.5" /> Featured article
      </div>
      <h3 className="mt-2 text-base font-semibold text-ink">{article.title}</h3>
      {article.body_excerpt ? (
        <p className="mt-1 text-sm text-[color:var(--color-ink-2)]">{article.body_excerpt}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[color:var(--color-ink-3)]">
        {article.author_name ? <span>By {article.author_name}</span> : null}
        {article.published_on ? <span>· {article.published_on}</span> : null}
        {article.gcid ? (
          <Link
            to={hubPath(article.gcid, article.topic)}
            className="font-medium text-[color:var(--color-g-blue)]"
          >
            {article.topic ? `More on ${prettyTopic(article.topic)}` : "Category hub"} →
          </Link>
        ) : null}
      </div>
    </article>
  );
}
