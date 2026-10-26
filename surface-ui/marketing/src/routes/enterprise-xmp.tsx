import { createFileRoute } from "@tanstack/react-router";
import { getPublicPageBySlug } from "@v3/shared/public/utils/public-site.functions";
import { CmsMarketingPage, cmsMarketingHead } from "@v3/marketing/components/marketing/pages/cms-marketing-page";

const SLUG = "enterprise-xmp";

export const Route = createFileRoute("/enterprise-xmp")({
  loader: () => getPublicPageBySlug({ data: { slug: SLUG } }),
  head: ({ loaderData }) => cmsMarketingHead(loaderData ?? null, "Enterprise XMP | Experience.com"),
  component: () => <CmsMarketingPage page={Route.useLoaderData()} label="Enterprise XMP" />,
  notFoundComponent: () => <CmsMarketingPage page={null} label="Enterprise XMP" />,
});
