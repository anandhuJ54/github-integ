import { createFileRoute } from "@tanstack/react-router";
import { ExpertiseGraphPage } from "@v3/graph/components/graph/expertise-graph-page";

export const Route = createFileRoute("/p_/$slug/graph")({
  head: () => ({
    meta: [
      { title: "Expertise Graph · Professional · Experience.com" },
      {
        name: "description",
        content:
          "Interactive expertise graph for this professional: identity, credentials, services, reputation and content nodes with their verified sources.",
      },
      { property: "og:title", content: "Expertise Graph · Professional" },
      {
        property: "og:description",
        content:
          "Explore the live expertise graph powering this professional's Search Rank Score.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => {
    const { slug } = Route.useParams();
    return <ExpertiseGraphPage kind="professional" slug={slug} />;
  },
});
