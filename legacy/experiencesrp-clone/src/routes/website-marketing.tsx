import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@/components/marketing/layouts/marketing-page";
import Websites, { seoMeta, seoLinks } from "@/components/marketing/pages/Websites";

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
