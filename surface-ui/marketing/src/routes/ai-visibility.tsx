import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@v3/marketing/components/marketing/layouts/marketing-page";
import AiVisibility, { seoMeta, seoLinks } from "@v3/marketing/components/marketing/pages/AiVisibility";

export const Route = createFileRoute("/ai-visibility")({
  head: () => ({ meta: seoMeta, links: seoLinks }),
  component: MarketingRoute,
});

function MarketingRoute() {
  return (
    <MarketingPage>
      <AiVisibility />
    </MarketingPage>
  );
}
