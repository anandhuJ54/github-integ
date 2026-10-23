import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@v3/ui/components/marketing/layouts/marketing-page";
import Social, { seoMeta, seoLinks } from "@v3/marketing/components/marketing/pages/Social";

export const Route = createFileRoute("/social")({
  head: () => ({ meta: seoMeta, links: seoLinks }),
  component: MarketingRoute,
});

function MarketingRoute() {
  return (
    <MarketingPage>
      <Social />
    </MarketingPage>
  );
}
