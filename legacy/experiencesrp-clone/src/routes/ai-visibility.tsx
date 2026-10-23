import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@/components/marketing/layouts/marketing-page";
import AiVisibility, { seoMeta, seoLinks } from "@/components/marketing/pages/AiVisibility";

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
