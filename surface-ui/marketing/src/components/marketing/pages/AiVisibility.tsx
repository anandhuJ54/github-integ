import { ogImageUrl } from "@v3/ui/lib/marketing/seo";
import { PageBreadcrumb } from "@v3/marketing/components/marketing/PageBreadcrumb";
import {
  AiVisibilityHeroSection,
  AiVisibilityStrategicBanner,
  AiVisibilityCapabilityStack,
  AiVisibilityEnterpriseGrid,
  AiVisibilityFAQSection,
} from "@v3/marketing/components/marketing/sections/ai-visibility";
import { SRPOverviewSection } from "@v3/marketing/components/marketing/sections/parent/SRPOverviewSection";
import { Search, PenTool, Radar } from "lucide-react";
import synergyImg from "@v3/marketing/assets/ai-visibility/synergy.png";
import { getSignUpUrl } from "@v3/ui/lib/marketing/envUrls";

const aiVisibilitySchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "AI Visibility",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description:
    "AI Visibility helps businesses understand how they appear in AI search results and take action to be surfaced, referenced, and recommended by AI engines like ChatGPT and Perplexity.",
  url: "https://www.experience.com/ai-visibility",
  provider: {
    "@type": "Organization",
    name: "Experience.com",
    url: "https://www.experience.com",
  },
  featureList: [
    "AI Authority Score",
    "AI writing agent for content creation",
    "Topic-level visibility tracking",
    "Structured data optimization for AI search",
    "Multi-location AI visibility management",
  ],
};

const AiVisibility = () => {
  return (
    <>
      <PageBreadcrumb label="AI Visibility" parents={[{ label: "Search Rank Platform", to: "https://www.experience.com/search-rank-platform" }]} />
      <AiVisibilityHeroSection />
      <AiVisibilityStrategicBanner />
      <AiVisibilityCapabilityStack />
      <AiVisibilityEnterpriseGrid />

      <SRPOverviewSection
        theme="light"
        primaryButtonHref={getSignUpUrl("utm_source=ai_visibility_pg&utm_medium=its_free_signup_today&utm_campaign=mid_btn")}
        secondaryButtonHref="/request-a-demo"
        contentOverride={{
          image: synergyImg,
          pill: "AI Visibility",
          headline: "Structure data. Earn trust. Be recommended.",
          alt: "First-time homebuyers guide article with AI Authority Score of 79 out of 100 and Search Rank Score of 682, shown alongside an AI search indicator",
          description:
            "One platform to optimize your digital footprint for LLMs and generative search landscapes.",
          bullets: [
            {
              icon: Search,
              title: "Audit Footprint",
              description:
                "Uncover exactly how generative AI engines parse, reference, and score your organizational data relative to your top industry competitors.",
            },
            {
              icon: PenTool,
              title: "Scale Expertise",
              description:
                "Maintain a consistent flow of authoritative content and answers across every location, without adding headcount.",
            },
            {
              icon: Radar,
              title: "Command Recommendations",
              description:
                "Continually sync local trust signals, accurate listings, and clean metadata to ensure AI models pull your business as the definitive recommendation.",
            },
          ],
        }}
      />

      <AiVisibilityFAQSection />
    </>
  );
};

export default AiVisibility;

export const seoMeta = [
  { title: "AI Visibility | Get Recommended in AI Search Results | Experience.com" },
  { "name": "description", "content": "See how your business shows up in AI search. Build the AI Authority Score, structured data, and content that get you chosen by ChatGPT, Perplexity, and Google AI." },
  { "name": "robots", "content": "index, follow" },
  { "property": "og:title", "content": "AI Visibility | Get Recommended in AI Search Results | Experience.com" },
  { "property": "og:description", "content": "See how your business shows up in AI search. Build the AI Authority Score and structured data that get you chosen by ChatGPT and Perplexity." },
  { "property": "og:url", "content": "https://www.experience.com/ai-visibility" },
  { "property": "og:type", "content": "website" },
  { "property": "og:image:alt", "content": "Woman working on laptop with AI Authority Score of 79 out of 100 and AI search result card for a real estate agent" },
  { "property": "og:site_name", "content": "Experience.com" },
  { "name": "twitter:card", "content": "summary_large_image" },
  { "name": "twitter:title", "content": "AI Visibility | Get Recommended in AI Search Results | Experience.com" },
  { "name": "twitter:description", "content": "See how your business shows up in AI search. Build the AI Authority Score and structured data that get you chosen by ChatGPT and Perplexity." },
  { "name": "twitter:image:alt", "content": "Woman working on laptop with AI Authority Score of 79 out of 100 and AI search result card for a real estate agent" },
  { "name": "twitter:site", "content": "@experience__com" },
  { "property": "og:image", "content": ogImageUrl("ai-visibility") },
  { "property": "og:image:secure_url", "content": ogImageUrl("ai-visibility") },
  { "property": "og:image:width", "content": "1200" },
  { "property": "og:image:height", "content": "630" },
  { "property": "og:image:type", "content": "image/png" },
  { "name": "twitter:image", "content": ogImageUrl("ai-visibility") },
];

export const seoLinks = [
  { rel: "canonical", href: "https://www.experience.com/ai-visibility" },
];
