import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@v3/marketing/components/marketing/layouts/marketing-page";
import Custom404, { seoMeta } from "@v3/app/components/marketing/pages/Custom404";

export const Route = createFileRoute("/404")({
  head: () => ({ meta: seoMeta }),
  component: MarketingRoute,
});

function MarketingRoute() {
  return (
    <MarketingPage>
      <Custom404 />
    </MarketingPage>
  );
}
