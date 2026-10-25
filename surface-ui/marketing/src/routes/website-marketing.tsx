import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@v3/marketing/components/marketing/layouts/marketing-page";
import Websites, { seoMeta, seoLinks } from "@v3/marketing/components/marketing/pages/Websites";

export const Route = createFileRoute("/website-marketing")({
  head: () => ({ meta: seoMeta, links: seoLinks }),
  component: MarketingRoute,
});

function MarketingRoute() {
  return (
    <MarketingPage>
      <Websites />
    </MarketingPage>
  );
}
