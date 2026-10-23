import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@v3/ui/components/marketing/layouts/marketing-page";
import ContactUs, { seoMeta, seoLinks } from "@v3/marketing/components/marketing/pages/ContactUs";

export const Route = createFileRoute("/contact-us")({
  head: () => ({ meta: seoMeta, links: seoLinks }),
  component: MarketingRoute,
});

function MarketingRoute() {
  return (
    <MarketingPage>
      <ContactUs />
    </MarketingPage>
  );
}
