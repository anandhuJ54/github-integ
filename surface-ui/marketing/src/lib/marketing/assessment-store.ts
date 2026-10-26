// src/lib/assessment-store.ts — scanner portion

export type CategoryStatus =
  | "Excellent"
  | "Strong"
  | "Good"
  | "Average"
  | "Needs Improvement"
  | "Low";

export interface CategoryScore {
  key: string;
  label: string;
  status: CategoryStatus;
  score: number;
  blurb: string;
}

export interface AssessmentLead {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  city: string;
  state: string;
  brokerage: string;
  score: number;
  createdAt: number;
  categories: CategoryScore[];
  biggestStrength: string;
  biggestOpportunity: string;
  aiSummary: string;
  premiumRecommendations: string[];
  conversationStarter: string;
}

// Deterministic-ish assessment generator based on name+brokerage
export function generateAssessment(input: {
  firstName: string;
  lastName: string;
  email: string;
  city: string;
  state: string;
  brokerage: string;
}): AssessmentLead {
  const seedStr = `${input.firstName}|${input.lastName}|${input.brokerage}|${input.city}`;
  let seed = 0;
  for (const c of seedStr) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;

  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  const between = (a: number, b: number) => Math.round(a + rand() * (b - a));

  const cats: CategoryScore[] = [
    {
      key: "google",
      label: "Google Presence",
      status: "Good",
      score: between(55, 92),
      blurb:
        "Your Google Business Profile shows up in local searches with steady engagement.",
    },
    {
      key: "reviews",
      label: "Review Authority",
      status: "Strong",
      score: between(60, 95),
      blurb:
        "You have a healthy volume of recent reviews building buyer confidence.",
    },
    {
      key: "ai",
      label: "AI Search Visibility",
      status: "Needs Improvement",
      score: between(30, 65),
      blurb:
        "AI assistants have limited context to confidently recommend you today.",
    },
    {
      key: "directories",
      label: "Directory Coverage",
      status: "Good",
      score: between(50, 85),
      blurb:
        "You appear across most major real-estate directories with consistent info.",
    },
    {
      key: "website",
      label: "Website Authority",
      status: "Average",
      score: between(40, 75),
      blurb:
        "Your site loads well but lacks the depth signals search engines reward.",
    },
    {
      key: "content",
      label: "Content Authority",
      status: "Low",
      score: between(25, 60),
      blurb:
        "There's little original local content tying your name to your market.",
    },
  ].map((c) => ({ ...c, status: statusFor(c.score) }));

  const score = Math.round(cats.reduce((s, c) => s + c.score, 0) / cats.length);

  const strongest = [...cats].sort((a, b) => b.score - a.score)[0];
  const weakest = [...cats].sort((a, b) => a.score - b.score)[0];

  return {
    id: crypto.randomUUID(),
    ...input,
    score,
    createdAt: Date.now(),
    categories: cats,
    biggestStrength: `${strongest.label} is your standout — buyers see social proof quickly when they search for you.`,
    biggestOpportunity: `Your ${weakest.label.toLowerCase()} is holding you back. Publishing authoritative local content tied to ${input.city}, ${input.state} would meaningfully lift how AI describes you.`,
    aiSummary: `${input.firstName}, based on your online presence you appear to have built a trusted local reputation in ${input.city}, but your authority signals are inconsistent across AI search engines. Strengthening your digital identity around your name and market would increase the likelihood that Google and AI recommend you when buyers ask "who should I use to buy a home?"`,
    premiumRecommendations: [
      `Publish 3 neighborhood guides for ${input.city} to feed AI models fresh, local context.`,
      `Consolidate your review sources so AI engines can cite one authoritative rating.`,
      `Add structured schema to your listings so AI can quote your expertise verbatim.`,
    ],
    conversationStarter: conversationStarterFor(weakest.key),
  };
}

function statusFor(score: number): CategoryStatus {
  if (score >= 85) return "Excellent";
  if (score >= 75) return "Strong";
  if (score >= 65) return "Good";
  if (score >= 50) return "Average";
  if (score >= 40) return "Needs Improvement";
  return "Low";
}

function conversationStarterFor(key: string): string {
  switch (key) {
    case "reviews":
      return "Talk about reviews and how Experience.com centralizes review authority.";
    case "ai":
      return "Discuss AI Visibility and demo the Search Rank Platform.";
    case "content":
      return "Introduce VOCE and content authority strategy.";
    case "website":
      return "Show Search Rank Platform for site authority signals.";
    case "directories":
      return "Discuss directory syndication and consistency scoring.";
    default:
      return "Start with the AI Visibility score and where they'd like to improve first.";
  }
}
