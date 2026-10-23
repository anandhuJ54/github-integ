import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@/components/marketing/layouts/marketing-page";
import Custom404, { seoMeta } from "@/components/marketing/pages/Custom404";

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
