// A ready SRS API response for tests (srp/srs-page-schema): the shape of GET /srp/seat/professional/{id}/srs, for a seat on 390 of 850
// with the screen's sample gaps. Lanes are in the API's order: most open points first.
import type { SrsApi } from "@v3/srp/utils/srs-model";

type L = SrsApi["lanes"] extends (infer T)[] | null ? T : never;

const lane = (key: string, name: string, short: string | null, earned: number, max: number, status: L["status"], you: string | null, rival: string | null,
  note: string | null, label: string | null, target: L["action_target"]): L => ({
  key, name, short_name: short, earned, max, open: max - earned, status, you_text: you, rival_text: rival, note, action_label: label, action_target: target,
});

export const api = (over: Partial<SrsApi> = {}): SrsApi => ({
  as_of: "2026-10-27T10:00:00Z",
  data: "mock",
  ready: true,
  score: { total: 390, max: 850, open_total: 460, as_of: "2026-10-27T12:00:00Z", band: { name: "Building", min_points: 0, next: { name: "Established", min_points: 400, points_needed: 10 } } },
  rank: { position: 6, of: 41, city: "Davenport" },
  rival: { name: "Riverbend Bank & Trust", score: 571, points_to_first: 181, review_count: 412, review_avg: 4.7 },
  lanes: [
    lane("completeness", "Completeness", "Completeness", 77, 182, "Fix", "Bio thin, service areas missing", "a full profile", null, "Fill my profile", "profile"),
    lane("articles", "Articles", "Articles", 18, 103, "Missing", "0", "14 articles", null, "Start publishing", "voce"),
    lane("website", "Website", "Website", 40, 102, "Fix", "No markup", "full markup", null, "Fix my website", "website"),
    lane("directories", "Directories", "Directories", 42, 90, "Fix · locked", "9 consistent", "28", null, "Unlock Listings", "billing"),
    lane("connections", "Connections", "Connections", 4, 51, "Fix", "2", "5 connected accounts", null, "Connect accounts", "connections"),
    lane("reviews", "Reviews", "Reviews", 142, 187, "Strong", "128", "412 reviews", "31 in the last 12 months", "See reviews", "reviews"),
    lane("qa", "Q&A", "Q&A", 0, 34, "Missing", "0", "12 answered", null, "Answer questions", "chat"),
    lane("videos", "Videos", "Videos", 0, 27, "Missing", "Last video 23 months old", "a video a month", null, "Plan a video", "chat"),
    lane("audio", "Audio", "Audio", 0, 6, "Missing", "No audio", "3 episodes", null, "Plan a podcast", "chat"),
    lane("gbp", "Google Business Profile", "GBP", 67, 68, "Strong", "Connected", "Connected", "services added today", "View connection", "connections"),
  ],
  counts: { all: 10, missing: 4, fix: 4, strong: 2 },
  notes: [
    { title: "Completeness gets you to Established.", body: "It's 105 points open, and you only need 10 to cross 400.", cta: "Fill my profile", action: "profile" },
    { title: "Your Articles is costing you 85 points.", body: "Riverbend Bank & Trust: 14 articles. You: 0.", cta: "Start publishing", action: "voce" },
    { title: "GBP is already strong.", body: "services added today", cta: "View connection", action: "connections" },
  ],
  ...over,
});
