import { createFileRoute } from "@tanstack/react-router";
import { ExpertiseGraphPage } from "@v3/graph/components/graph/expertise-graph-page";

export const Route = createFileRoute("/o_/$slug/graph")({
  head: () => ({
    meta: [
      { title: "Expertise Graph · Office · Experience.com" },
      {
        name: "description",
        content:
          "Interactive expertise graph for this office location: identity, presence, services, reputation and content nodes with verified sources.",
      },
      { property: "og:title", content: "Expertise Graph · Office" },
      {
        property: "og:description",
        content: "Explore the live expertise graph behind this office location.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => {
    const { slug } = Route.useParams();
    return <ExpertiseGraphPage kind="office" slug={slug} />;
  },
});
