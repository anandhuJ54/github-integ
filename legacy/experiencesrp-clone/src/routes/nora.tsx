import { createFileRoute } from "@tanstack/react-router";
import { getPublicPageBySlug } from "@/lib/public-site.functions";
import { CmsMarketingPage, cmsMarketingHead } from "@/components/marketing/pages/cms-marketing-page";

const SLUG = "nora";

export const Route = createFileRoute("/nora")({
  loader: () => getPublicPageBySlug({ data: { slug: SLUG } }),
  head: ({ loaderData }) => cmsMarketingHead(loaderData ?? null, "Nora | Experience.com"),
  component: () => <CmsMarketingPage page={Route.useLoaderData()} label="Nora" />,
  notFoundComponent: () => <CmsMarketingPage page={null} label="Nora" />,
});
