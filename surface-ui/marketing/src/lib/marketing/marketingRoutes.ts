/**
 * Paths routed to s-marketing by the load balancer (PathPrefix rules).
 * @see ingress HTTPRoute matches for s-marketing
 */
export const MARKETING_ROUTES = {
  reviews: "/reviews-management",
  listings: "/listings",
  campaigns: "/campaigns",
  insights: "/insights",
  social: "/social",
  searchRanking: "/search-ranking",
  websites: "/website",
  demo: "/demo",
  requestADemo: "/request-a-demo",
  custom404: "/404",
  contactUs: "/contact-us",
  aiVisibility: "/ai-visibility",
  content: "/content",
  customerStories: "/customer-stories",
  kwMegaCamp2026: "/kw-mega-camp-2026",
} as const;

/** Vite build base — assets load under /marketing/assets/ (covered by /marketing LB rule). */
export const MARKETING_ASSET_BASE = "/marketing/";

export type MarketingRouteKey = keyof typeof MARKETING_ROUTES;

export const MARKETING_ROUTE_PATHS = Object.values(MARKETING_ROUTES);

export function isMarketingRoute(pathname: string): boolean {
  return MARKETING_ROUTE_PATHS.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
