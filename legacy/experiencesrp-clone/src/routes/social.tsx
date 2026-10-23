import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@/components/marketing/layouts/marketing-page";
import Social, { seoMeta, seoLinks } from "@/components/marketing/pages/Social";

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
