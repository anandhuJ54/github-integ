const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Experience.com",
  legalName: "BuyersRoad Inc. DBA Experience.com",
  url: "https://www.experience.com",
  logo: "https://swis-asset.experience.com/public/assets/logos/logo.svg",
  foundingDate: "2015",
  description:
    "Experience.com is a local search ranking and reputation management platform helping individuals, local businesses, and multi-location enterprises improve search visibility, manage reviews, build AI visibility, and turn customer experiences into measurable growth.",
  sameAs: [
    "https://www.linkedin.com/company/experiencecom/",
    "https://www.facebook.com/experiencecom",
    "https://www.instagram.com/experience_com/",
    "https://www.youtube.com/@experience_com/featured",
    "https://x.com/experience__com",
  ],
};

const breadcrumbSchema = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    {
      "@type": "ListItem",
      position: 1,
      name: "Home",
      item: "https://www.experience.com",
    },
    {
      "@type": "ListItem",
      position: 2,
      name: "KW Mega Camp 2026",
      item: "https://www.experience.com/kw-mega-camp-2026/",
    },
  ],
};

const eventSchema = {
  "@context": "https://schema.org",
  "@type": "Event",
  name: "KW Mega Camp 2026",
  description:
    "Keller Williams Mega Camp 2026 — Experience.com helps real estate agents run a free AI Visibility assessment and learn how ChatGPT, Gemini, and Google AI recommend their business to buyers and sellers.",
  url: "https://www.experience.com/kw-mega-camp-2026/",
  organizer: {
    "@type": "Organization",
    name: "Experience.com",
    url: "https://www.experience.com",
  },
  location: {
    "@type": "Place",
    name: "KW Mega Camp 2026",
  },
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    description: "Free AI Visibility assessment for attendees.",
    url: "https://www.experience.com/kw-mega-camp-2026/",
  },
};

const productReviewSchema = {
  "@context": "https://schema.org",
  "@type": "Product",
  name: "Experience.com Search Rank Platform",
  review: [
    {
      "@type": "Review",
      author: { "@type": "Person", name: "Rob B." },
      reviewBody:
        "The SEO help has been great to help potential clients find me. There are several mega agents in my area that spend huge amounts on SEO and I am now able to compete on that level with a small monthly investment.",
    },
    {
      "@type": "Review",
      author: { "@type": "Person", name: "Bettina S." },
      reviewBody:
        "Experience.com helps me understand how I can help my clients in the future and improve my service. It makes the review process easy and lets me compare my performance with other agents in the local market.",
    },
    {
      "@type": "Review",
      author: { "@type": "Person", name: "Marisa G." },
      reviewBody:
        "I use Experience.com to increase searchability on AI and find realtor clients. The fact that Experience.com connects to all my profiles across the Internet is really helpful.",
    },
    {
      "@type": "Review",
      author: { "@type": "Person", name: "Carmen C." },
      reviewBody:
        "I like how Experience.com consolidates everything in one place, making it easily accessible for clients, employees, employers, and partners.",
    },
  ],
};

export const KwMegaCampPageSchema = () => (
  <>
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
    />
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
    />
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(eventSchema) }}
    />
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(productReviewSchema) }}
    />
  </>
);


export default KwMegaCampPageSchema;
