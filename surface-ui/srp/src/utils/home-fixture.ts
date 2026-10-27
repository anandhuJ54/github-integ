// A ready Home API response for tests (srp/home-page-schema): the shape of GET /srp/seat/professional/{id}/home.
import type { HomeApi } from "@v3/srp/utils/home-model";

export const api = (over: Partial<HomeApi> = {}): HomeApi => ({
  as_of: "2026-10-27T10:00:00Z",
  data: "mock",
  ready: true,
  day: { n: 8, trial_days: 30, layout: "day7", over: false },
  person: { first_name: "Pat", full_name: "Pat Example", title: "Loan officer", photo_url: null, year_started: 2014, credentials: 2 },
  trial: { plan: { key: "core", name: "Core", tag: "Free after your 30-day trial" }, started_at: "2026-10-20T09:00:00Z", nora_text_day: "Tuesday early morning" },
  score: {
    total: 420, max: 850, band: { name: "Established", min_points: 400, next: { name: "Leading", min_points: 600 } }, as_of: "2026-10-27T12:00:00Z",
    since_claim: 120, week_delta: 70, lanes: [{ key: "reviews", name: "Reviews", points: 100, max: 187 }],
  },
  rank: { position: 6, of: 41, city: "Davenport", first_position: 12 },
  rival: { name: "Riverbend Bank & Trust", initial: "R", score: 571, points_to_first: 151, review_count: 412, review_avg: 4.7, article_count: 14 },
  competitors: { count: 5 },
  board: {
    latest: { label: "Adding your Google category and services", points: 6, status: "done", started_at: "2026-10-27T10:30:00Z", completed_at: "2026-10-27T11:00:00Z" },
    done: [{ label: "Adding your Google category and services", points: 6 }, { label: "Mapped 5 competitors", points: null }],
    done_count: 2, since_claim_points: 6,
    next_moves: [{ icon: "pen", title: "Start publishing", subtitle: null, recommended: true, target: "voce", points: 85 }],
    moves: { done: 2, goal: 3 }, streak_weeks: 1, needs_you_count: 1,
  },
  tiles: {
    map: { scanned_at: "2026-10-20T08:00:00Z", top3: 2, total: 49, cells: [{ row: 0, col: 0, rank: 1 }, { row: 0, col: 1, rank: null }] },
    ai: { cited: 1, checked: 7, checked_at: "2026-10-26T10:00:00Z" },
    reviews: { avg: 4.9, count: 128, as_of: "2026-10-27T12:00:00Z" },
    profile_strength: { pct: 64, previous_pct: 50 },
    website: { score: 91, max: 102, url: "https://example.test/seat-34" },
    articles: { published: 3, total: 4 },
  },
  locked: {
    features: [
      { key: "listings", title: "Listings", description: "Directories miss you.", points_waiting: 87, plan: "engage" },
      { key: "map_rank", title: "Map Rank tracking", description: "See the week you pass the leader.", points_waiting: null, plan: "amplify" },
    ],
    points_waiting: 87,
  },
  peers: { band_from: "Building", median_gain: 61, horizon_days: 90, cohort_size: 34, cohort_period: "Jan–Sep 2026", reached_next_band: 3, of: 5 },
  brief: {
    week_start: "2026-10-20T00:00:00Z", points_total: 14, items: [{ label: "Bio approved", points: 8 }, { label: "Service areas added", points: 6 }],
    next_move: { label: "Fix my website", points: 42, target: "website" }, away: { new_reviews: 1, bio_live: true, first_article: false },
  },
  drafts: [{ id: 1, reviewer_label: "Reviewer A. (mock)", rating: 5, review_text: "Great", draft_text: "Thanks", compliance_status: "passed", status: "draft" },
           { id: 2, reviewer_label: "Reviewer B. (mock)", rating: 2, review_text: "Slow", draft_text: "Sorry", compliance_status: "needs_edit", status: "draft" }],
  events: [{ kind: "facebook", title: "Your Facebook connection expires Friday", body: null, action_label: "Reconnect", expires_at: "2026-10-30T12:00:00Z" }],
  insights: [{ position: 1, title: "Lead is content", body: "They have 14 articles.", cta: null, action: "voce" }],
  recap: null,
  plans: [{ key: "core", name: "Core", tag: null, highlight: false, items: ["Your profile"] }, { key: "amplify", name: "Amplify", tag: "Includes Engage", highlight: true, items: ["Everything in Engage"] }],
  ...over,
});
