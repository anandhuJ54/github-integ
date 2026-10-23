const primarySchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "Websites",
      alternateName: "Experience.com Websites",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: "https://www.experience.com/website",
      description:
        "This feature helps businesses and professionals build, analyze, and optimize their website and web presence from one platform. It improves web analytics, SEO performance, AI search visibility, site speed, technical SEO, local search visibility, and customer conversion through search-optimized profiles, website audits, performance insights, and scalable website management.",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        description:
          "Advanced website optimization, web analytics, SEO audit, performance intelligence, and enterprise website features may be available with paid plans.",
      },
      featureList: [
        "Website optimization",
        "Web analytics",
        "Website performance analytics",
        "SEO audit",
        "Technical SEO insights",
        "AI search visibility",
        "Search-optimized web profiles",
        "Local SEO support",
        "Website ranking improvements",
        "Website health monitoring",
        "Website performance tracking",
        "Traffic and engagement analytics",
        "City and state performance analysis",
        "Profile traffic tracking",
        "Website speed optimization",
        "Secure website infrastructure",
        "Structured web profiles",
        "Verified reviews and ratings display",
        "Mobile-optimized layouts",
        "Conversion-focused web profiles",
        "Multi-location website management",
        "Brand consistency controls",
        "NAP consistency support",
        "Market authority tools",
        "Website conversion optimization",
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
        "Experience.com is an experience and reputation platform that helps professionals, local businesses, and enterprises manage reviews, listings, websites, social media, reputation, search visibility, AI visibility, and customer experiences from one platform.",
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

export const WebsitesPageSchema = () => (
  <script
    type="application/ld+json"
    dangerouslySetInnerHTML={{ __html: JSON.stringify(primarySchema) }}
  />
);

export default WebsitesPageSchema;
