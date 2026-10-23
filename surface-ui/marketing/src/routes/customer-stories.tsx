import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@v3/ui/components/marketing/layouts/marketing-page";
import CustomerStories, { seoMeta, seoLinks } from "@v3/marketing/components/marketing/pages/CustomerStories";

export const Route = createFileRoute("/customer-stories")({
  head: () => ({ meta: seoMeta, links: seoLinks }),
  component: MarketingRoute,
});

function MarketingRoute() {
  return (
    <MarketingPage>
      <CustomerStories />
    </MarketingPage>
  );
}
