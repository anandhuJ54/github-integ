import { ogImageUrl } from "@v3/marketing/utils/marketing/seo";
import { PageBreadcrumb } from "@v3/marketing/components/marketing/PageBreadcrumb";
import { ContentHeroSection } from "@v3/marketing/components/marketing/sections/content/ContentHeroSection";
import { ContentStrategicBanner } from "@v3/marketing/components/marketing/sections/content/ContentStrategicBanner";
import { ContentCapabilityStack } from "@v3/marketing/components/marketing/sections/content/ContentCapabilityStack";
import { ContentEnterpriseGrid } from "@v3/marketing/components/marketing/sections/content/ContentEnterpriseGrid";
import { ContentPageSchema } from "@v3/marketing/components/marketing/sections/content/ContentPageSchema";
import { ContentFAQSection } from "@v3/marketing/components/marketing/sections/content/ContentFAQSection";
import { SRPOverviewSection } from "@v3/marketing/components/marketing/sections/parent/SRPOverviewSection";
import { PenTool, Share2, HelpCircle } from "lucide-react";
import synergyAsset from "@v3/marketing/assets/content/Content_Child5_Platform_Synergy.png";
import { getSignUpUrl } from "@v3/marketing/utils/marketing/envUrls";

const pageTitle =
  "Content Writing & Publishing Platform for AI Discovery & Local Authority | Experience.com";
const pageDescription =
  "Research, write, and publish professional content that builds local authority, strengthens expertise, and improves visibility across search and AI.";
const pageKeywords =
  "AI content creation, local SEO content, AI writing for professionals, content marketing, AI content marketing platform, content marketing software, AI writing platform, AI writing studio, content management platform, professional content creation, search visibility content, AI search visibility, generative engine optimization, GEO content, local authority content, question-based content, structured content for AI discovery, content syndication, social content publishing, Google Display Network content, VOCE AI, professional services content marketing, multi-location content management, brand voice control";
const canonicalUrl = "https://www.experience.com/content";

const Content = () => {
  return (
    <>
      <ContentPageSchema />
      <PageBreadcrumb label="Content" parents={[{ label: "Search Rank Platform", to: "https://www.experience.com/search-rank-platform" }]} />
      <ContentHeroSection />
      <ContentStrategicBanner />
      <ContentCapabilityStack />
      <ContentEnterpriseGrid />

      <SRPOverviewSection
        theme="light"
        primaryButtonHref={getSignUpUrl("utm_source=content_pg&utm_medium=its_free_signup_today&utm_campaign=mid_btn")}
        secondaryButtonHref="/request-a-demo"
        contentOverride={{
          image: synergyAsset,
          alt: "VOCE-powered content workspace connecting AI writing, scheduling, and multi-channel publishing into one platform.",
          pill: "Content Management",
          headline: "Author expertise. Sync channels. Dominate search.",
          description: "One platform to transform raw domain knowledge into a visible, AI-optimized content footprint.",
          bullets: [
            {
              icon: PenTool,
              title: "Streamline Authorship",
              description: "Leverage specialized AI writing workspaces to research target topics and deploy high-quality, professional articles that perfectly mirror your brand voice.",
            },
            {
              icon: Share2,
              title: "Unify Distribution",
              description: "Instantly syndicate finished content across your locations, connected social platforms, and search networks with a single point of publishing authority.",
            },
            {
              icon: HelpCircle,
              title: "Answer Intent",
              description: "Target high-intent user prompts with question-based architecture, positioning your organization as the direct source material for search engine indexers and LLMs.",
            },
          ],
        }}
      />

      <ContentFAQSection />
    </>
  );
};

export default Content;

export const seoMeta = [
  { title: pageTitle },
  { "name": "description", "content": pageDescription },
  { "name": "keywords", "content": pageKeywords },
  { "property": "og:title", "content": "Create Content That Helps Customers Find You | Experience.com" },
  { "property": "og:description", "content": "Create structured, expert content that helps customers find you across search and AI. Build local authority without extra time or complexity." },
  { "property": "og:type", "content": "website" },
  { "property": "og:url", "content": canonicalUrl },
  { "property": "og:site_name", "content": "Experience.com" },
  { "name": "twitter:card", "content": "summary_large_image" },
  { "name": "twitter:title", "content": "Create Content That Helps Customers Find You | Experience.com" },
  { "name": "twitter:description", "content": "Create structured, expert content that helps customers find you across search and AI. Build local authority without extra time or complexity." },
  { "name": "robots", "content": "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1" },
  { "property": "og:image", "content": ogImageUrl("content") },
  { "property": "og:image:secure_url", "content": ogImageUrl("content") },
  { "property": "og:image:width", "content": "1200" },
  { "property": "og:image:height", "content": "630" },
  { "property": "og:image:type", "content": "image/png" },
  { "property": "og:image:alt", "content": "Content platform creating structured, expert content that builds local authority across search and AI." },
  { "name": "twitter:image", "content": ogImageUrl("content") },
  { "name": "twitter:image:alt", "content": "Content platform creating structured, expert content that builds local authority across search and AI." },
];

export const seoLinks = [
  { rel: "canonical", href: canonicalUrl },
];
