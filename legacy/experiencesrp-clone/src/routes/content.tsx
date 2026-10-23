import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@/components/marketing/layouts/marketing-page";
import Content, { seoMeta, seoLinks } from "@/components/marketing/pages/Content";

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
