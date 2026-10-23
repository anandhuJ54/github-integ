const softwareApplicationSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Reviews",
  alternateName: "Experience.com Reviews",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  url: "https://www.experience.com/reviews-management",
  description:
    "Experience.com helps businesses collect, manage, respond to, and amplify customer reviews from one platform. Build trust, strengthen reputation, improve search visibility, and influence AI-powered recommendations with automated review collection, AI-assisted responses, review syndication, governance workflows, and multi-location control.",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    description:
      "Free to start. Advanced review management, automation, governance, and enterprise features may be available with paid plans.",
  },
  featureList: [
    "Automated review collection",
    "Review management dashboard",
    "Centralized multi-platform review inbox",
    "AI-assisted review response suggestions",
    "Review-level sentiment and trend alerts",
    "Google review management",
    "Review syndication across profiles and social channels",
    "Verified social proof highlights",
    "Reputation governance workflows",
    "Automated content moderation",
    "Spam and sensitive content filters",
    "Centralized approval workflows",
    "Local search ranking signals",
    "Schema markup for star ratings",
    "Structured data syncing for AI discovery",
    "Hierarchy-based user permissions",
    "Multi-location review management",
    "Enterprise-grade audit logs",
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
    "Experience.com is an experience and reputation platform that helps professionals, local businesses, and enterprises collect reviews, manage reputation, improve search visibility, build AI visibility, and turn customer experiences into measurable growth.",
  sameAs: [
    "https://www.linkedin.com/company/experiencecom/",
    "https://www.facebook.com/experiencecom",
    "https://www.instagram.com/experience_com/",
    "https://www.youtube.com/@experience_com/featured",
    "https://x.com/experience__com",
  ],
};

const faqPageSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What is review management software?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Review management software helps businesses collect, monitor, respond to, and distribute customer reviews from one place. Experience.com's Reviews product helps teams turn customer feedback into trust signals that strengthen reputation, improve search visibility, and influence AI-powered recommendations."
      }
    },
    {
      "@type": "Question",
      "name": "How do customer reviews help businesses get chosen?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Customer reviews help businesses build trust at the moment customers are comparing options. Fresh, authentic reviews give buyers confidence, reinforce credibility across channels, and increase the likelihood that a business is selected over competitors."
      }
    },
    {
      "@type": "Question",
      "name": "How do reviews influence search visibility?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Reviews create fresh, relevant content and trust signals that search engines use to evaluate business credibility. A consistent flow of authentic reviews can improve local search performance, strengthen authority, and help businesses appear more prominently when customers are searching."
      }
    },
    {
      "@type": "Question",
      "name": "Can reviews help businesses appear in AI-powered recommendations?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes. Reviews give AI systems more trustworthy signals about customer experience, reputation, and business quality. When reviews are recent, authentic, and consistently managed, they help AI-driven search models better understand which businesses are credible enough to recommend."
      }
    },
    {
      "@type": "Question",
      "name": "How does Experience.com help businesses collect more reviews?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Experience.com helps businesses automatically request reviews through SMS and email at the right moments in the customer journey. This makes it easier to capture feedback while the experience is still fresh, improving response rates without creating friction for customers."
      }
    },
    {
      "@type": "Question",
      "name": "How does Experience.com help teams manage and respond to reviews?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Experience.com gives teams a centralized dashboard to monitor reviews across platforms and respond from one place. AI-assisted reply suggestions help businesses respond faster while maintaining brand consistency, accuracy, and compliance."
      }
    },
    {
      "@type": "Question",
      "name": "How does Experience.com help businesses use reviews across the buyer journey?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Experience.com helps businesses activate reviews beyond a single profile by syndicating verified feedback across profiles and social channels. This allows strong customer sentiment to reinforce credibility wherever buyers are researching and making decisions."
      }
    },
    {
      "@type": "Question",
      "name": "Is Experience.com's Reviews product built for multi-location and enterprise teams?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes. Experience.com's Reviews product is built for organizations that need control and consistency at scale. It supports governance workflows, hierarchy-based permissions, moderation tools, and multi-location review management so brands can protect reputation while growing efficiently."
      }
    }
  ]
};

export const ReviewsPageSchema = () => (
  <>
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplicationSchema) }}
    />
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
    />
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(faqPageSchema) }}
    />
  </>
);

export default ReviewsPageSchema;
