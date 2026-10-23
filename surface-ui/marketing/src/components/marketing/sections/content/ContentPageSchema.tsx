const schema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "Content",
      alternateName: [
        "Experience.com Content",
        "VOCE AI",
        "Experience.com Content Management",
      ],
      applicationCategory: "BusinessApplication",
      applicationSubCategory: [
        "Content Marketing Software",
        "AI Writing Software",
        "Content Management Platform",
        "Generative Engine Optimization Software",
        "Multi-Channel Publishing Software",
      ],
      operatingSystem: "Web",
      url: "https://www.experience.com/content",
      description:
        "Experience.com Content helps professionals and businesses research, write, publish, and manage professional content that improves visibility across search and AI. Powered by VOCE, the platform supports AI-assisted topic research, article drafting, tone refinement, question-based content, structured content for AI discovery, social syndication, Google Display Network promotion, brand voice control, and multi-location publishing workflows.",
      offers: {
        "@type": "Offer",
        url: "https://www.experience.com/content",
        priceCurrency: "USD",
        price: "0",
        description:
          "Free to start. Advanced AI writing, content management, syndication, publishing, and enterprise controls may be available with paid plans.",
      },
      featureList: [
        "AI-assisted topic research",
        "AI article drafting",
        "Professional content formatting",
        "Tone refinement",
        "Brand voice control",
        "VOCE-powered AI writing workspace",
        "Content management dashboard",
        "Question-based content templates",
        "Expertise-linked search signals",
        "Structured content for AI discovery",
        "AI-optimized content publishing",
        "Automated social channel syndication",
        "Google Display Network integration",
        "Cross-platform publishing logs",
        "Multi-channel content distribution",
        "Centralized content management",
        "Multi-location content publishing",
        "Organizational hierarchy and user permissions",
        "Scalable expertise distribution",
        "Ask and Answer content workflow",
        "Connected profile reinforcement",
        "Search and AI visibility support",
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
        "Experience.com is an experience and reputation platform that helps professionals, local businesses, and enterprises manage reviews, listings, websites, social media, content, insights, reputation, search visibility, AI visibility, and customer experiences from one platform.",
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

export const ContentPageSchema = () => (
  <script
    type="application/ld+json"
    dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
  />
);

export default ContentPageSchema;
