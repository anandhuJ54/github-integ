import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@v3/marketing/components/marketing/layouts/marketing-page";
import Insights, { seoMeta, seoLinks } from "@v3/marketing/components/marketing/pages/Insights";

export const Route = createFileRoute("/insights")({
  head: () => ({ meta: seoMeta, links: seoLinks }),
  component: MarketingRoute,
});

function MarketingRoute() {
  return (
    <MarketingPage>
      <Insights />
    </MarketingPage>
  );
}
