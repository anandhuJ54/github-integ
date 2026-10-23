import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@/components/marketing/layouts/marketing-page";
import Reviews, { seoMeta, seoLinks } from "@/components/marketing/pages/Reviews";

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
