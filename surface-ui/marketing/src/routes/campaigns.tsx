import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@v3/marketing/components/marketing/layouts/marketing-page";
import Campaigns, { seoMeta, seoLinks } from "@v3/marketing/components/marketing/pages/Campaigns";

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
