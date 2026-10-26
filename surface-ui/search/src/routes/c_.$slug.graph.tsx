import { createFileRoute } from "@tanstack/react-router";
import { ExpertiseGraphPage } from "@v3/search/components/graph/expertise-graph-page";

export const Route = createFileRoute("/c_/$slug/graph")({
  head: () => ({
    meta: [
      { title: "Expertise Graph · Company · Experience.com" },
      {
        name: "description",
        content:
          "Interactive expertise graph for this company: brand identity, presence, services, reputation and content nodes with verified sources.",
      },
      { property: "og:title", content: "Expertise Graph · Company" },
      {
        property: "og:description",
        content: "Explore the live expertise graph behind this company brand.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => {
    const { slug } = Route.useParams();
    return <ExpertiseGraphPage kind="company" slug={slug} />;
  },
});
