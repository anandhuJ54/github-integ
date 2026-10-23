import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@v3/ui/components/marketing/layouts/marketing-page";
import Demo from "@v3/marketing/components/marketing/pages/Demo";

export const Route = createFileRoute("/demo")({
  head: () => ({
    meta: [
      { title: "Product Demo — See the Search Rank Platform | Experience.com" },
      {
        name: "description",
        content:
          "Watch the Experience.com platform in action: reviews, listings, content and AI search visibility in one place.",
      },
      { property: "og:title", content: "Product Demo — See the Search Rank Platform | Experience.com" },
      {
        property: "og:description",
        content:
          "Watch the Experience.com platform in action: reviews, listings, content and AI search visibility in one place.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MarketingRoute,
});

function MarketingRoute() {
  return (
    <MarketingPage>
      <Demo />
    </MarketingPage>
  );
}
