import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@/components/marketing/layouts/marketing-page";
import CustomerStories, { seoMeta, seoLinks } from "@/components/marketing/pages/CustomerStories";

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
