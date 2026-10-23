const softwareApplicationSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Campaigns",
  alternateName: "Experience.com Campaigns",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  url: "https://www.experience.com/campaigns",
  description:
    "Experience.com Campaigns helps businesses automate personalized email and SMS campaigns based on customer actions, visits, purchases, and milestones. The platform helps teams generate reviews, capture feedback, trigger surveys, improve engagement, and drive repeat business without adding manual work.",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    description:
      "Free to start. Advanced campaign automation, personalization, reporting, routing, and enterprise features may be available with paid plans.",
  },
  featureList: [
    "Automated customer campaigns",
    "Email and SMS campaign automation",
    "Behavior-based campaign triggers",
    "Visit and purchase-based outreach",
    "Milestone-based customer campaigns",
    "Personalized customer messaging",
    "Flexible campaign scheduling",
    "Campaign frequency control",
    "Review generation campaigns",
    "Customer feedback collection",
    "Mobile-optimized survey flows",
    "Instant feedback alerts",
    "Private feedback channels",
    "Pre-approved campaign templates",
    "Brand standards enforcement",
    "Content control workflows",
    "Team access management",
    "Smart feedback routing",
    "Multi-location campaign management",
    "Campaign performance reporting",
    "Response rate tracking",
    "Location-level dashboards",
    "Customer retention campaigns",
    "Repeat business campaigns",
  ],
  publisher: {
    "@type": "Organization",
    name: "Experience.com",
    url: "https://www.experience.com",
  },
};

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Experience.com",
  legalName: "BuyersRoad Inc. DBA Experience.com",
  url: "https://www.experience.com",
  logo: "https://swis-asset.experience.com/public/assets/logos/logo.svg",
  foundingDate: "2015",
  description:
    "Experience.com is an experience and reputation platform that helps professionals, local businesses, and enterprises automate campaigns, capture feedback, generate reviews, manage reputation, and turn customer experiences into measurable growth.",
  sameAs: [
    "https://www.linkedin.com/company/experiencecom/",
    "https://www.facebook.com/experiencecom",
    "https://www.instagram.com/experience_com/",
    "https://www.youtube.com/@experience_com/featured",
    "https://x.com/experience__com",
  ],
};

export const CampaignsPageSchema = () => (
  <>
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplicationSchema) }}
    />
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
    />
  </>
);

export default CampaignsPageSchema;
