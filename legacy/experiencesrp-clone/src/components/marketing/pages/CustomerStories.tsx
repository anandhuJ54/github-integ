import {
  CustomerStoriesHeroSection,
  CustomerStoriesHighSRS,
  CustomerStoriesFeaturedVideo,
  CustomerStoriesSuccessGrid,
  CustomerStoriesLogoSlider,
} from "@/components/marketing/sections/customer-stories";
import { ogImageUrl } from "@/lib/marketing/seo";

const pageTitle = "Customer Stories | Real Search & Reputation Results | Experience.com";
const pageDescription =
  "See how real estate, mortgage, and insurance teams use Experience.com to grow reviews, climb local search, and get recommended by AI.";
const canonicalUrl = "https://www.experience.com/customer-stories";
const ogAlt =
  "Customer success stories showing search rank, review growth, and AI visibility gains for Experience.com clients.";

const CustomerStories = () => {
  return (
    <>
      <CustomerStoriesHeroSection />
      <CustomerStoriesFeaturedVideo />
      <CustomerStoriesHighSRS />
      <CustomerStoriesSuccessGrid />
      <CustomerStoriesLogoSlider />
    </>
  );
};

export default CustomerStories;

export const seoMeta = [
  { title: pageTitle },
  { "name": "description", "content": pageDescription },
  { "name": "keywords", "content": "customer success stories, reputation management case studies, local search results, review growth case study, AI visibility results" },
  { "name": "robots", "content": "noindex, nofollow" },
  { "property": "og:title", "content": pageTitle },
  { "property": "og:description", "content": pageDescription },
  { "property": "og:type", "content": "website" },
  { "property": "og:url", "content": canonicalUrl },
  { "property": "og:site_name", "content": "Experience.com" },
  { "property": "og:image", "content": ogImageUrl("customer-stories") },
  { "property": "og:image:secure_url", "content": ogImageUrl("customer-stories") },
  { "property": "og:image:width", "content": "1200" },
  { "property": "og:image:height", "content": "630" },
  { "property": "og:image:type", "content": "image/png" },
  { "property": "og:image:alt", "content": ogAlt },
  { "name": "twitter:card", "content": "summary_large_image" },
  { "name": "twitter:title", "content": pageTitle },
  { "name": "twitter:description", "content": pageDescription },
  { "name": "twitter:image", "content": ogImageUrl("customer-stories") },
  { "name": "twitter:image:alt", "content": ogAlt },
  { "name": "twitter:site", "content": "@experience__com" },
];

export const seoLinks = [
  { rel: "canonical", href: canonicalUrl },
];
