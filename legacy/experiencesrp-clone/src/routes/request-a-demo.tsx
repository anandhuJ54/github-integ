import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@/components/marketing/layouts/marketing-page";
import RequestADemo, { seoMeta, seoLinks } from "@/components/marketing/pages/RequestADemo";

export const Route = createFileRoute("/request-a-demo")({
  head: () => ({ meta: seoMeta, links: seoLinks }),
  component: MarketingRoute,
});

function MarketingRoute() {
  return (
    <MarketingPage>
      <RequestADemo />
    </MarketingPage>
  );
}
