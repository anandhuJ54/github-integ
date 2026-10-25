import { createFileRoute } from "@tanstack/react-router";
import { loadHub } from "@v3/search/lib/voce-hub";
import { TopicHub } from "@v3/search/components/voce/topic-hub";

export const Route = createFileRoute("/topic/$gcid")({
  loader: ({ params }) => loadHub(params.gcid, null),
  head: ({ loaderData }) => {
    const label = loaderData?.label ?? "Category";
    const title = `${label} insights & top-ranked professionals`.slice(0, 60);
    const description =
      `Expert ${label.toLowerCase()} articles plus the highest Search Rank Score professionals and offices in this category.`.slice(
        0,
        158,
      );
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  errorComponent: () => (
    <div className="mx-auto max-w-3xl p-10 text-sm text-slate-600">
      This hub is unavailable right now.
    </div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-3xl p-10 text-sm text-slate-600">Hub not found.</div>
  ),
  component: () => <TopicHub hub={Route.useLoaderData()} />,
});
