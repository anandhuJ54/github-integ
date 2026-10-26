import { ogImageUrl } from "@v3/marketing/utils/marketing/seo";
import { PageBreadcrumb } from "@v3/marketing/components/marketing/PageBreadcrumb";
import {
  WebsitesHeroSection,
  WebsitesStrategicBanner,
  WebsitesCapabilityStack,
  WebsitesEnterpriseGrid,
  WebsitesFAQSection,
  WebsitesPageSchema,
} from "@v3/marketing/components/marketing/sections/websites";
import { SRPOverviewSection } from "@v3/marketing/components/marketing/sections/parent/SRPOverviewSection";
import { Zap, BarChart3, TrendingUp } from "lucide-react";
import srpWebAnalytics from "@v3/marketing/assets/websites/srp-web-analytics.png";
import { getSignUpUrl } from "@v3/marketing/utils/marketing/envUrls";

const Websites = () => {
  return (
    <>
      <WebsitesPageSchema />
      <PageBreadcrumb label="Website" parents={[{ label: "Search Rank Platform", to: "https://www.experience.com/search-rank-platform" }]} />

      <WebsitesHeroSection />
      <WebsitesStrategicBanner />
      <WebsitesCapabilityStack />
      <WebsitesEnterpriseGrid />

      <SRPOverviewSection
        theme="light"
        primaryButtonHref={getSignUpUrl("utm_source=websites_pg&utm_medium=its_free_signup_today&utm_campaign=mid_btn")}
        secondaryButtonHref="/request-a-demo"
        contentOverride={{
          image: srpWebAnalytics,
          pill: "Website Management",
          alt:"Website optimization dashboard combining SEO attributes, analytics scores, performance trends, and actionable recommendations to improve search visibility.",
          headline: "Maximize speed. Master SEO. Convert traffic.",
          description: "One platform to analyze site performance, capture trust, and dominate search visibility.",
          bullets: [
            {
              icon: Zap,
              title: "Build Authority",
              description: "Deploy lightning-fast, secure, and structured web profiles designed to feed clean data signals directly to search engines and AI models.",
            },
            {
              icon: BarChart3,
              title: "Analyze Intelligence",
              description: "Track traffic, visitor geography, and deep web analytics to continuously optimize your search footprint and find new local growth opportunities.",
            },
            {
              icon: TrendingUp,
              title: "Convert Intent",
              description: "Seamlessly merge verified customer reviews and high-performance layouts to capture incoming traffic and turn visitors into brand trust and revenue.",
            },
          ],
        }}
      />
      <WebsitesFAQSection />
    </>
  );
};

export default Websites;

export const seoMeta = [
  { title: "Website Optimization Platform for SEO & AI Visibility | Experience.com" },
  { "name": "description", "content": "Build, analyze, and optimize your website from one platform. Improve web analytics, SEO performance, AI search visibility, and customer conversion." },
  { "name": "keywords", "content": "local SEO website for professionals, professional website builder, local search optimized website, SEO website for loan officers, local business landing page" },
  { "name": "robots", "content": "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1" },
  { "property": "og:title", "content": "Website SEO, Analytics & AI Visibility Platform | Experience.com" },
  { "property": "og:description", "content": "Build, analyze, and optimize your web presence from one platform. Improve SEO, AI search visibility, website performance, and conversions with confidence." },
  { "property": "og:type", "content": "website" },
  { "property": "og:url", "content": "https://www.experience.com/website" },
  { "property": "og:site_name", "content": "Experience.com" },
  { "property": "og:image", "content": ogImageUrl("website") },
  { "property": "og:image:secure_url", "content": ogImageUrl("website") },
  { "property": "og:image:width", "content": "1200" },
  { "property": "og:image:height", "content": "630" },
  { "property": "og:image:type", "content": "image/png" },
  { "property": "og:image:alt", "content": "Website optimization dashboard showing SEO scores, analytics, and AI search visibility recommendations." },
  { "name": "twitter:card", "content": "summary_large_image" },
  { "name": "twitter:image", "content": ogImageUrl("website") },
  { "name": "twitter:image:alt", "content": "Website optimization dashboard showing SEO scores, analytics, and AI search visibility recommendations." },
  { "name": "twitter:title", "content": "Website SEO, Analytics & AI Visibility Platform | Experience.com" },
  { "name": "twitter:description", "content": "Build, analyze, and optimize your web presence from one platform. Improve SEO, AI search visibility, website performance, and conversions with confidence." },
];

export const seoLinks = [
  { rel: "canonical", href: "https://www.experience.com/website" },
];
