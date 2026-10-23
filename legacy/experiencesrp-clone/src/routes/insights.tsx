import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@/components/marketing/layouts/marketing-page";
import Insights, { seoMeta, seoLinks } from "@/components/marketing/pages/Insights";

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
