import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@v3/ui/components/marketing/layouts/marketing-page";
import KwMegaCamp2026, { seoMeta, seoLinks } from "@v3/marketing/components/marketing/pages/KwMegaCamp2026";

export const Route = createFileRoute("/kw-mega-camp-2026")({
  head: () => ({ meta: seoMeta, links: seoLinks }),
  component: MarketingRoute,
});

function MarketingRoute() {
  return (
    <MarketingPage showFinalCTA={false}>
      <KwMegaCamp2026 />
    </MarketingPage>
  );
}
