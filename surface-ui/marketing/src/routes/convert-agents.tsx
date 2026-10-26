import { createFileRoute } from "@tanstack/react-router";
import { getPublicPageBySlug } from "@v3/shared/public/utils/public-site.functions";
import { CmsMarketingPage, cmsMarketingHead } from "@v3/marketing/components/marketing/pages/cms-marketing-page";

const SLUG = "convert-agents";

export const Route = createFileRoute("/convert-agents")({
  loader: () => getPublicPageBySlug({ data: { slug: SLUG } }),
  head: ({ loaderData }) => cmsMarketingHead(loaderData ?? null, "Convert Agents | Experience.com"),
  component: () => <CmsMarketingPage page={Route.useLoaderData()} label="Convert Agents" />,
  notFoundComponent: () => <CmsMarketingPage page={null} label="Convert Agents" />,
});
