import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@v3/marketing/components/marketing/layouts/marketing-page";
import Reviews, { seoMeta, seoLinks } from "@v3/marketing/components/marketing/pages/Reviews";

export const Route = createFileRoute("/reviews-management")({
  head: () => ({ meta: seoMeta, links: seoLinks }),
  component: MarketingRoute,
});

function MarketingRoute() {
  return (
    <MarketingPage>
      <Reviews />
    </MarketingPage>
  );
}
