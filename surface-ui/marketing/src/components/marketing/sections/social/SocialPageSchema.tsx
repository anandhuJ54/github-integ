const primarySchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "Social",
      alternateName: "Experience.com Social",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: "https://www.experience.com/social",
      description:
        "Experience.com Social helps businesses create, schedule, publish, monitor, and manage social media content from one centralized dashboard. The platform helps teams publish across Google, LinkedIn, Facebook, Instagram, and X, turn five-star reviews into branded social posts, engage with comments, mentions, and DMs, and maintain brand consistency across every location.",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        description:
          "Free to start. Advanced social publishing, review-to-social automation, monitoring, engagement, and enterprise features may be available with paid plans.",
      },
      featureList: [
        "Social media management",
        "Social media scheduling",
        "Social media publishing",
        "Multi-platform social publishing",
        "Google social posts",
        "LinkedIn publishing",
        "Facebook publishing",
        "Instagram publishing",
        "X publishing",
        "Centralized social media dashboard",
        "Social media content calendar",
        "Post previews",
        "Smart scheduling",
        "Review-to-social content automation",
        "Automatic five-star review sharing",
        "Custom branded social templates",
        "Social media monitoring",
        "Comments, mentions, and DM management",
        "Real-time engagement inbox",
        "Brand safety controls",
        "Approval workflows",
        "Multi-location social management",
        "Brand consistency management",
        "Social performance monitoring",
        "Social engagement signals",
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
        "Experience.com is an experience and reputation platform that helps professionals, local businesses, and enterprises manage reviews, listings, social media, reputation, search visibility, AI visibility, and customer experiences from one platform.",
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

export const SocialPageSchema = () => (
  <script
    type="application/ld+json"
    dangerouslySetInnerHTML={{ __html: JSON.stringify(primarySchema) }}
  />
);

export default SocialPageSchema;
