const primarySchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "Insights",
      alternateName: "Experience.com Insights",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: "https://www.experience.com/insights",
      description:
        "Experience.com Insights helps businesses track visibility, engagement, traffic, and search performance from one platform. The product turns real-time performance data into actionable insights that help teams understand how customers find them, monitor profile and website engagement, visualize visibility trends, benchmark locations, and identify where to focus next for growth.",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        description:
          "Free to start. Advanced performance insights, visibility tracking, analytics, benchmarking, and enterprise reporting features may be available with paid plans.",
      },
      featureList: [
        "Performance insights dashboard",
        "Search performance tracking",
        "Visibility tracking",
        "Engagement analytics",
        "Traffic analytics",
        "Profile view tracking",
        "Website engagement tracking",
        "Impressions and clicks tracking",
        "Customer action tracking",
        "City and state visitor insights",
        "Geographic performance trends",
        "Google and Bing trend tracking",
        "AI readiness insights",
        "Organic and branded search comparison",
        "Review impact analysis",
        "Outreach performance tracking",
        "Conversion metrics",
        "Real-time performance monitoring",
        "Configurable dashboard widgets",
        "Cross-platform data syncing",
        "Multi-location performance reporting",
        "Location benchmarking",
        "Top-performer highlighting",
        "Growth opportunity mapping",
      ],
      publisher: {
        "@type": "Organization",
        name: "Experience.com",
        url: "https://www.experience.com",
      },
    },
    {
      "@type": "Organization",
      name: "Experience.com",
      legalName: "BuyersRoad Inc. DBA Experience.com",
      url: "https://www.experience.com",
      logo: "https://swis-asset.experience.com/public/assets/logos/logo.svg",
      foundingDate: "2015",
      description:
        "Experience.com is an experience and reputation platform that helps professionals, local businesses, and enterprises manage reviews, listings, websites, social media, insights, reputation, search visibility, AI visibility, and customer experiences from one platform.",
      sameAs: [
        "https://www.linkedin.com/company/experiencecom/",
        "https://www.facebook.com/experiencecom",
        "https://www.instagram.com/experience_com/",
        "https://www.youtube.com/@experience_com/featured",
        "https://x.com/experience__com",
      ],
    },
  ],
};

export const InsightsPageSchema = () => (
  <script
    type="application/ld+json"
    dangerouslySetInnerHTML={{ __html: JSON.stringify(primarySchema) }}
  />
);

export default InsightsPageSchema;
