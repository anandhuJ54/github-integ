import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@v3/marketing/components/marketing/layouts/marketing-page";
import Content, { seoMeta, seoLinks } from "@v3/marketing/components/marketing/pages/Content";

export const Route = createFileRoute("/content")({
  head: () => ({ meta: seoMeta, links: seoLinks }),
  component: MarketingRoute,
});

function MarketingRoute() {
  return (
    <MarketingPage>
      <Content />
    </MarketingPage>
  );
}
