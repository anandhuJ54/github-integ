import { ogImageUrl } from "@v3/ui/lib/marketing/seo";
import {
  CampaignsHeroSection,
  CampaignsStrategicBanner,
  CampaignsCapabilityStack,
  CampaignsEnterpriseGrid,
  CampaignsFAQSection,
  CampaignsPageSchema,
} from "@v3/marketing/components/marketing/sections/campaigns";
import { SRPOverviewSection } from "@v3/marketing/components/marketing/sections/parent/SRPOverviewSection";
import { Send, MessageSquare, TrendingUp } from "lucide-react";
import campaignsOverview from "@v3/marketing/assets/campaigns/overview.png";
import { PageBreadcrumb } from "@v3/marketing/components/marketing/PageBreadcrumb";

const Campaigns = () => {
  return (
    <>
      <CampaignsPageSchema />
      <PageBreadcrumb label="Campaigns" parents={[{ label: "Experience Management Platform", to: "https://www.experience.com/experience-management-platform" }]} />
      <CampaignsHeroSection />
      <CampaignsStrategicBanner />
      <CampaignsCapabilityStack />
      <CampaignsEnterpriseGrid />

      <SRPOverviewSection
        theme="light"
        primaryButtonHref="https://app.experience.com/user/signup?utm_source=campaigns_pg&utm_medium=its_free_signup_today&utm_campaign=mid_btn"
        contentOverride={{
          image: campaignsOverview,
          imageScale: "lg:scale-[1.1]",
          alt: "Customer satisfaction survey platform measuring response rates, NPS and GPS scores, completion metrics, and feedback trends.",
          pill: "Campaigns Management",
          headline: "Trigger outreach. Capture proof. Scale growth.",
          description: "One platform to automate customer touchpoints and turn interactions into asset value.",
          bullets: [
            {
              icon: Send,
              title: "Automate Outreach",
              description: "Deploy behavior-based SMS and email triggers that fire the exact millisecond a transaction happens, removing all manual effort from client follow-ups.",
            },
            {
              icon: MessageSquare,
              title: "Harvest Sentiment",
              description: "Intercept customer feedback instantly via frictionless, mobile-optimized flows that effortlessly generate public five-star reviews or open private lines to resolve issues.",
            },
            {
              icon: TrendingUp,
              title: "Feed the Platform",
              description: "Funnel your freshly captured review data and customer signals straight back into your listings, traditional search algorithms, and AI recommendation engines to continuously pull in your next customer.",
            },
          ],
        }}
      />
      <CampaignsFAQSection />
    </>
  );
};

export default Campaigns;

export const seoMeta = [
  { title: "Campaign Automation Software for Reviews & Feedback | Experience.com" },
  { "name": "description", "content": "Automate personalized email and SMS campaigns that generate reviews, capture feedback, and drive repeat business at the right customer moments." },
  { "name": "keywords", "content": "review request automation, customer feedback campaigns, survey automation, review collection software, automated outreach platform" },
  { "name": "robots", "content": "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1" },
  { "property": "og:title", "content": "Automated Customer Campaigns | Capture Feedback & Drive Growth" },
  { "property": "og:description", "content": "Automate personalized email and SMS campaigns that generate reviews, capture feedback, and drive repeat business at the right customer moments." },
  { "property": "og:type", "content": "website" },
  { "property": "og:url", "content": "https://www.experience.com/campaigns" },
  { "property": "og:site_name", "content": "Experience.com" },
  { "name": "twitter:card", "content": "summary_large_image" },
  { "name": "twitter:title", "content": "Automated Customer Campaigns | Capture Feedback & Drive Growth" },
  { "name": "twitter:description", "content": "Automate personalized email and SMS campaigns that generate reviews, capture feedback, and drive repeat business at the right customer moments." },
  { "name": "twitter:image:alt", "content": "Campaign automation dashboard triggering email and SMS outreach that captures customer feedback and reviews." },
  { "name": "twitter:site", "content": "@experience__com" },
  { "property": "og:image", "content": ogImageUrl("campaigns") },
  { "property": "og:image:secure_url", "content": ogImageUrl("campaigns") },
  { "property": "og:image:width", "content": "1200" },
  { "property": "og:image:height", "content": "630" },
  { "property": "og:image:type", "content": "image/png" },
  { "property": "og:image:alt", "content": "Campaign automation dashboard triggering email and SMS outreach that captures customer feedback and reviews." },
  { "name": "twitter:image", "content": ogImageUrl("campaigns") },
];

export const seoLinks = [
  { rel: "canonical", href: "https://www.experience.com/campaigns" },
];
