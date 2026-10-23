import { ogImageUrl } from "@/lib/marketing/seo";
import {
  InsightsHeroSection,
  InsightsStrategicBanner,
  InsightsCapabilityStack,
  InsightsEnterpriseGrid,
  InsightsFAQSection,
  InsightsPageSchema,
} from "@/components/marketing/sections/search-ranking";
import { SRPOverviewSection } from "@/components/marketing/sections/parent/SRPOverviewSection";
import { PageBreadcrumb } from "@/components/marketing/PageBreadcrumb";
import { Database, TrendingUp, Rocket } from "lucide-react";
import placeholderImg from "@/assets/insights/overview.png";
import { getSignUpUrl } from "@/lib/marketing/envUrls";

const Insights = () => {
  return (
    <>
      <InsightsPageSchema />
      <PageBreadcrumb label="Insights" parents={[{ label: "Search Rank Platform", to: "https://www.experience.com/search-rank-platform" }]} />
      <InsightsHeroSection />
      <InsightsStrategicBanner />
      <InsightsCapabilityStack />
      <InsightsEnterpriseGrid />

      <SRPOverviewSection
        theme="light"
        primaryButtonHref={getSignUpUrl("utm_source=insights_pg&utm_medium=its_free_signup_today&utm_campaign=mid_btn")}
        secondaryButtonHref="/request-a-demo"
        contentOverride={{
          image: placeholderImg,
          imageScale: "lg:scale-100",
          pill: "Performance Insights",
          headline: "Analyze traffic. Decode trends. Predict growth.",
          alt:"Centralized performance dashboard with configurable widgets for real-time reputation and visibility monitoring",
          description:
            "One platform to transform complex performance metrics into prioritized, high-impact strategies.",
          bullets: [
            {
              icon: Database,
              title: "Centralize Performance",
              description:
                "Aggregate visibility, conversion, and engagement data from every location into a single operational interface, replacing static reports with dynamic intelligence.",
            },
            {
              icon: TrendingUp,
              title: "Track Momentum",
              description:
                "Monitor daily, weekly, and seasonal ranking trends across Google and Bing to isolate market shifts early and pivot your execution before competitors react.",
            },
            {
              icon: Rocket,
              title: "Fuel Strategy",
              description:
                "Funnel granular customer journey and attribution data straight back into your listings, reputation, and website setups to scale your entire digital footprint automatically.",
            },
          ],
        }}
      />

      <InsightsFAQSection />
    </>
  );
};

export default Insights;

export const seoMeta = [
  { title: "Performance Insights Dashboard for Search & Growth | Experience.com" },
  { "name": "description", "content": "Track visibility, engagement, traffic, and search performance in one place. Turn real-time data into clear insights that improve rank and reveal where to focus next." },
  { "name": "keywords", "content": "customer feedback analytics, experience analytics, survey insights platform, review analytics, local search performance analytics, customer experience metrics" },
  { "name": "robots", "content": "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1" },
  { "property": "og:title", "content": "Performance Insights for Search, Traffic & Growth | Experience.com" },
  { "property": "og:description", "content": "Track visibility, engagement, traffic, and search performance in one place. Turn real-time data into clear insights that improve rank and reveal where to focus next." },
  { "property": "og:type", "content": "website" },
  { "property": "og:url", "content": "https://www.experience.com/insights" },
  { "property": "og:site_name", "content": "Experience.com" },
  { "property": "og:image", "content": ogImageUrl("insights") },
  { "property": "og:image:secure_url", "content": ogImageUrl("insights") },
  { "property": "og:image:width", "content": "1200" },
  { "property": "og:image:height", "content": "630" },
  { "property": "og:image:type", "content": "image/png" },
  { "property": "og:image:alt", "content": "Performance insights dashboard tracking visibility, engagement, traffic, and search rank trends." },
  { "name": "twitter:card", "content": "summary_large_image" },
  { "name": "twitter:image", "content": ogImageUrl("insights") },
  { "name": "twitter:image:alt", "content": "Performance insights dashboard tracking visibility, engagement, traffic, and search rank trends." },
  { "name": "twitter:title", "content": "Performance Insights for Search, Traffic & Growth | Experience.com" },
  { "name": "twitter:description", "content": "Track visibility, engagement, traffic, and search performance in one place. Turn real-time data into clear insights that improve rank and reveal where to focus next." },
];

export const seoLinks = [
  { rel: "canonical", href: "https://www.experience.com/insights" },
];
