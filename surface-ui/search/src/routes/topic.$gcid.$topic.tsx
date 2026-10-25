import { createFileRoute } from "@tanstack/react-router";
import { loadHub } from "@v3/search/lib/voce-hub";
import { TopicHub } from "@v3/search/components/voce/topic-hub";
import { prettyTopic } from "@v3/ui/lib/voce";

export const Route = createFileRoute("/topic/$gcid/$topic")({
  loader: ({ params }) => loadHub(params.gcid, params.topic),
  head: ({ loaderData, params }) => {
    const topic = prettyTopic(params.topic) ?? "Topic";
    const label = loaderData?.label ?? "Category";
    const title = `${topic} — ${label} insights`.slice(0, 60);
    const description =
      `${topic} articles from ${label.toLowerCase()} experts, with the top-ranked professionals covering this topic.`.slice(
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
      This topic hub is unavailable right now.
    </div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-3xl p-10 text-sm text-slate-600">Topic not found.</div>
  ),
  component: () => <TopicHub hub={Route.useLoaderData()} />,
});
