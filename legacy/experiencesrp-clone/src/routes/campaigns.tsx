import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@/components/marketing/layouts/marketing-page";
import Campaigns, { seoMeta, seoLinks } from "@/components/marketing/pages/Campaigns";

export const Route = createFileRoute("/campaigns")({
  head: () => ({ meta: seoMeta, links: seoLinks }),
  component: MarketingRoute,
});

function MarketingRoute() {
  return (
    <MarketingPage>
      <Campaigns />
    </MarketingPage>
  );
}
