import { ogImageUrl } from "@v3/ui/lib/marketing/seo";
import {
  ReviewsHeroSection,
  ReviewsStrategicBanner,
  ReviewsCapabilityStack,
  ReviewsManageSection,
  ReviewsActivateSection,
  ReviewsCardSliderSection,
  ReviewsPageSchema,
} from "@v3/marketing/components/marketing/sections/reviews";
import { ReviewsFAQSection } from "@v3/marketing/components/marketing/sections/reviews/ReviewsFAQSection";
import { SRPOverviewSection } from "@v3/marketing/components/marketing/sections/parent/SRPOverviewSection";
import { PageBreadcrumb } from "@v3/marketing/components/marketing/PageBreadcrumb";
import { Star, Share2, TrendingUp } from "lucide-react";
import reviewsEcosystemImg from "@v3/marketing/assets/reviews-ecosystem-hero.png";
import { getSignUpUrl } from "@v3/ui/lib/marketing/envUrls";

const pageTitle = "Review Management - Improve Reputation & AI Search | Experience.com";
const pageDescription =
  "Collect, manage, and respond to reviews from one platform. Build trust, improve search visibility, and influence AI-powered recommendations.";
const pageKeywords =
  "review management platform, online review management, Google review management, reputation reviews, star rating management, respond to reviews";
const canonicalUrl = "https://www.experience.com/reviews-management";

const Reviews = () => {
  return (
    <>
      <ReviewsPageSchema />
      <PageBreadcrumb label="Reviews" parents={[{ label: "Search Rank Platform", to: "https://www.experience.com/search-rank-platform" }]} />
      <ReviewsHeroSection />
      <ReviewsStrategicBanner />
      
      <ReviewsManageSection />
      <ReviewsActivateSection />
      <ReviewsCardSliderSection />

      <SRPOverviewSection
        theme="light"
        primaryButtonHref={getSignUpUrl("utm_source=review_pg&utm_medium=its_free_signup_today&utm_campaign=mid_btn")}
        secondaryButtonHref="/request-a-demo"
        contentOverride={{
          image: reviewsEcosystemImg,
          alt: "Centralized review management platform collecting reviews from multiple sources, generating AI responses, and distributing content across social channels.",
          pill: "Reviews Management",
          headline: "More reviews. More visibility. More growth.",
          description: "One platform to capture, sync, and scale your brand authority.",
          bullets: [
            {
              icon: Star,
              title: "Capture Proof",
              description: "Automatically harvest the five-star ratings, fresh text, and positive sentiment that convince customers to choose you over everyone else.",
            },
            {
              icon: Share2,
              title: "Sync Signals",
              description: "Instantly push and protect your verified review data across 40+ local maps, premium search engines, and major directories.",
            },
            {
              icon: TrendingUp,
              title: "Scale Authority",
              description: "Feed structured review metadata directly into search algorithms and AI data models to secure your spot as the definitive local answer.",
            },
          ],
        }}
      />

      <ReviewsFAQSection />
    </>
  );
};

export default Reviews;

export const seoMeta = [
  { title: pageTitle },
  { "name": "description", "content": pageDescription },
  { "name": "keywords", "content": pageKeywords },
  { "property": "og:title", "content": "Automate Review Process \u2013 Earn Trust & Get Chosen | Experience.com" },
  { "property": "og:description", "content": "Collect, manage, and respond to reviews from one platform. Build trust, improve search, and influence AI-powered recommendations." },
  { "property": "og:type", "content": "website" },
  { "property": "og:url", "content": canonicalUrl },
  { "property": "og:site_name", "content": "Experience.com" },
  { "name": "robots", "content": "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1" },
  { "property": "og:image", "content": ogImageUrl("reviews-management") },
  { "property": "og:image:secure_url", "content": ogImageUrl("reviews-management") },
  { "property": "og:image:width", "content": "1200" },
  { "property": "og:image:height", "content": "630" },
  { "property": "og:image:type", "content": "image/png" },
  { "property": "og:image:alt", "content": "Review management dashboard collecting, responding to, and syndicating customer reviews across search and AI platforms." },
  { "name": "twitter:card", "content": "summary_large_image" },
  { "name": "twitter:image", "content": ogImageUrl("reviews-management") },
  { "name": "twitter:image:alt", "content": "Review management dashboard collecting, responding to, and syndicating customer reviews across search and AI platforms." },
  { "name": "twitter:title", "content": "Automate Review Process \u2013 Earn Trust & Get Chosen | Experience.com" },
  { "name": "twitter:description", "content": "Collect, manage, and respond to reviews from one platform. Build trust, improve search, and influence AI-powered recommendations." },
];

export const seoLinks = [
  { rel: "canonical", href: canonicalUrl },
];
