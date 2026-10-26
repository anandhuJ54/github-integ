import { createFileRoute } from "@tanstack/react-router";
import { getPublicPage } from "@v3/shared/public/utils/public-site.functions";
import { ContentCallout } from "@v3/marketing/components/landing/inspire/ContentCallout";
import { Features } from "@v3/marketing/components/landing/inspire/Features";
import { GettingStarted } from "@v3/marketing/components/landing/inspire/GettingStarted";
import { Hero } from "@v3/marketing/components/landing/inspire/Hero";
import { Platform } from "@v3/marketing/components/landing/inspire/Platform";
import { TopBanner } from "@v3/marketing/components/landing/inspire/TopBanner";
import { ToolsConverge } from "@v3/marketing/components/landing/inspire/ToolsConverge";
import { InspireCopyProvider, inspireCopyFromBlocks } from "@v3/marketing/components/landing/inspire/copy";
import { SiteFooter, SiteHeader } from "@v3/shared/public/components/site-chrome";

const SLUG = "landing-page-inspire-example";
const TITLE = "Be the First Choice in Search and AI | Experience.com x Inspire Network";
const DESCRIPTION =
  "Inspire Network agents: rank higher in Google and AI answers with profiles, reviews, listings, and content powered by the Experience.com Search Rank Platform.";

export const Route = createFileRoute("/landing-page-inspire-example")({
  loader: () => getPublicPage({ data: { slug: SLUG, pageType: "landing" } }),
  head: ({ loaderData }) => {
    const title = loaderData?.seo_title ?? TITLE;
    const description = loaderData?.seo_desc ?? DESCRIPTION;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  component: InspireLanding,
  errorComponent: () => <InspireLandingBody />,
});

function InspireLanding() {
  const page = Route.useLoaderData();
  return <InspireLandingBody copy={inspireCopyFromBlocks(page?.body)} />;
}

function InspireLandingBody({ copy }: { copy?: Record<string, string> }) {
  return (
    <InspireCopyProvider value={copy}>
      <div className="min-h-screen bg-background font-insp-product">
        <SiteHeader />
        <main>
          <TopBanner />
          <div className="flex flex-col">
            <Hero />
            <ToolsConverge />
            <GettingStarted />
          </div>
          <div className="flex flex-col">
            <Features />
            <ContentCallout />
            <Platform />
          </div>
        </main>
        <SiteFooter />
      </div>
    </InspireCopyProvider>
  );
}
