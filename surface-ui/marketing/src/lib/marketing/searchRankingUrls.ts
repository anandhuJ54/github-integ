import { getRequestDemoUrl, getSignUpUrl } from "@v3/ui/lib/marketing/envUrls";

export const SEARCH_RANKING_URLS = {
  signUpTop: getSignUpUrl(
    "utm_source=sr_pg&utm_medium=sign_up_its-free&utm_campaign=top_btn",
  ),
  requestDemo: getRequestDemoUrl(),
  viewMyScore: getSignUpUrl(
    "utm_source=sr_pg&utm_medium=view_my_score&utm_campaign=mid_btn",
  ),
  exploreProfile: getSignUpUrl(
    "utm_source=sr_pg&utm_medium=explore_your_profile&utm_campaign=mid_btn",
  ),
  signUpBottom: getSignUpUrl(
    "utm_source=sr_pg&utm_medium=its_free_to_signup&utm_campaign=bottom_btn",
  ),
  signUpFooter: getSignUpUrl(
    "utm_source=sr_pg&utm_medium=sign_up_free&utm_campaign=footer_btn",
  ),
} as const;
