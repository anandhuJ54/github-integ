import { createFileRoute } from "@tanstack/react-router";
import { getPublicPageBySlug } from "@v3/ui/lib/public-site.functions";
import { CmsMarketingPage, cmsMarketingHead } from "@v3/marketing/components/marketing/pages/cms-marketing-page";

const SLUG = "voce";

export const Route = createFileRoute("/voce")({
  loader: () => getPublicPageBySlug({ data: { slug: SLUG } }),
  head: ({ loaderData }) => cmsMarketingHead(loaderData ?? null, "VOCE.com | Experience.com"),
  component: () => <CmsMarketingPage page={Route.useLoaderData()} label="VOCE.com" />,
  notFoundComponent: () => <CmsMarketingPage page={null} label="VOCE.com" />,
});
