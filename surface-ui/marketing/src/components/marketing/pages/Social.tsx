import { ogImageUrl } from "@v3/marketing/lib/marketing/seo";
import {
  SocialHeroSection,
  SocialStrategicBanner,
  SocialCapabilityStack,
  SocialEnterpriseGrid,
  SocialGrowthLoop,
  SocialFAQSection,
  SocialPageSchema,
} from "@v3/marketing/components/marketing/sections/social";
import { SRPOverviewSection } from "@v3/marketing/components/marketing/sections/parent/SRPOverviewSection";
import { Share2, Zap, TrendingUp } from "lucide-react";
import reviewsEcosystemImg from "@v3/marketing/assets/reviews-ecosystem-hero.png";
import socialMorePostsImg from "@v3/marketing/assets/social-more-posts.png";
import { getSignUpUrl } from "@v3/marketing/lib/marketing/envUrls";
import { PageBreadcrumb } from "@v3/marketing/components/marketing/PageBreadcrumb";

const Social = () => {
  return (
    <>
      <SocialPageSchema />
      <PageBreadcrumb label="Social" parents={[{ label: "Experience Management Platform", to: "https://www.experience.com/experience-management-platform" }]} />
      <SocialHeroSection />
      <SocialStrategicBanner />
      <SocialCapabilityStack />
      <SocialEnterpriseGrid />
      

      <SRPOverviewSection
        theme="light"
        primaryButtonHref={getSignUpUrl("utm_source=social_pg&utm_medium=its_free_signup_today&utm_campaign=mid_btn")}
        secondaryButtonHref="/request-a-demo"
        contentOverride={{
          image: socialMorePostsImg,
          pill: "Social Management",
          alt:"Social publishing dashboard distributing content across multiple channels while tracking engagement, reach, and audience interactions.",
          headline: "More posts. More engagement. More growth.",
          description: "One platform to plan, publish, and scale your brand across every social channel.",
          bullets: [
            {
              icon: Share2,
              title: "Publish at Scale",
              description: "Plan and schedule on-brand content across every channel from a single calendar built for multi-location teams.",
            },
            {
              icon: Zap,
              title: "Engage in Real Time",
              description: "Respond to comments, mentions, and DMs from one inbox so no customer signal slips through the cracks.",
            },
            {
              icon: TrendingUp,
              title: "Scale Authority",
              description: "Turn social engagement into structured signals that reinforce brand trust across search and AI surfaces.",
            },
          ],
        }}
      />
      <SocialFAQSection />
    </>
  );
};

export default Social;

export const seoMeta = [
  { title: "Social Media Monitoring, Scheduling & Management | Experience.com" },
  { "name": "description", "content": "Create, schedule, publish, and monitor social posts from one dashboard. Turn customer reviews into branded content that builds trust and visibility." },
  { "name": "keywords", "content": "social media management for local business, local business social media, multi-location social publishing, social media scheduling software, Google Business Profile social posts" },
  { "name": "robots", "content": "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1" },
  { "property": "og:title", "content": "Social Media Management & Publishing Platform | Experience.com" },
  { "property": "og:description", "content": "Plan, publish, and manage social content from one dashboard. Turn customer reviews into branded posts, engage in real time, and build trust across every channel." },
  { "property": "og:type", "content": "website" },
  { "property": "og:url", "content": "https://www.experience.com/social" },
  { "property": "og:site_name", "content": "Experience.com" },
  { "property": "og:image", "content": ogImageUrl("social") },
  { "property": "og:image:secure_url", "content": ogImageUrl("social") },
  { "property": "og:image:width", "content": "1200" },
  { "property": "og:image:height", "content": "630" },
  { "property": "og:image:type", "content": "image/png" },
  { "property": "og:image:alt", "content": "Social media management dashboard scheduling and publishing branded posts across every channel." },
  { "name": "twitter:card", "content": "summary_large_image" },
  { "name": "twitter:image", "content": ogImageUrl("social") },
  { "name": "twitter:image:alt", "content": "Social media management dashboard scheduling and publishing branded posts across every channel." },
  { "name": "twitter:title", "content": "Social Media Management & Publishing Platform | Experience.com" },
  { "name": "twitter:description", "content": "Plan, publish, and manage social content from one dashboard. Turn customer reviews into branded posts, engage in real time, and build trust across every channel." },
];

export const seoLinks = [
  { rel: "canonical", href: "https://www.experience.com/social" },
];
