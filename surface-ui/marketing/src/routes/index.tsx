import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "@v3/shared/public/components/site-chrome";
import { CityHome } from "@v3/marketing/components/public/city-home";
import { getHomeData } from "@v3/shared/public/utils/home.functions";
import { getCityHome } from "@v3/marketing/utils/city-home.functions";

const TITLE = "Search people, offices and brands | Experience.com";
const DESCRIPTION =
  "Ask in your own words and find the professionals, offices and brands worth choosing — every profile backed by verified expertise.";

export const Route = createFileRoute("/")({
  loader: async () => {
    const [home, city] = await Promise.all([getHomeData(), getCityHome({ data: {} })]);
    return { home, city };
  },
  staleTime: 10 * 60_000,
  gcTime: 30 * 60_000,
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://experiencesrp.lovable.app/" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://experiencesrp.lovable.app/" }],
  }),
  component: HomePage,
  errorComponent: () => (
    <SiteShell>
      <div className="mx-auto max-w-2xl px-6 py-32 text-center">
        <h1 className="text-2xl font-semibold text-foreground">This page didn't load</h1>
        <p className="mt-3 text-sm text-muted-foreground">Please refresh to try again.</p>
      </div>
    </SiteShell>
  ),
  notFoundComponent: () => (
    <SiteShell>
      <div className="mx-auto max-w-2xl px-6 py-32 text-center">
        <h1 className="text-2xl font-semibold text-foreground">Page not found</h1>
      </div>
    </SiteShell>
  ),
});

function HomePage() {
  const { home, city } = Route.useLoaderData();
  return (
    <SiteShell>
      <CityHome initial={city} authorityCount={home.authorityCount} />
    </SiteShell>
  );
}
