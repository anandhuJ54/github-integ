import { describe, expect, test } from "bun:test";
import { nextMoves, scorerMoves, type ProfessionalSeat, type SeatScore } from "../src/lib/seat";

// Gap shapes as written to search_rank_scores.gaps by each scorer version.
const v5Gaps = [
  { lane: "gbp", ring_key: "presence", registry_node_id: null, node_type: "gbp_place",
    label: "Connect and verify your Google Business Profile", status: "missing", marginal_pts: 68,
    is_core: false, evidence_source: "oauth_connections" },
  { lane: "reviews", ring_key: "reputation", registry_node_id: null, node_type: "review",
    label: "Earn a new 5-star review (and reply to it)", status: "missing", marginal_pts: 12.96,
    is_core: false, evidence_source: "aggregate_ratings" },
  { lane: "completeness", ring_key: "authority", registry_node_id: "6f1c0d0e-0000-4000-8000-000000000001",
    node_type: "npn_number", label: "NPN Number", status: "unverified", marginal_pts: 0.48,
    is_core: true, evidence_source: "etl" },
];
// exp_compute_score_v2 (live rows today)
const v2Gaps = [
  { lane: "Completeness", action: "Fill missing profile elements", gap: 123 },
  { lane: "Articles", action: "Publish articles", gap: 103 },
];

const score = (gaps: unknown): SeatScore => ({
  total_score: 0, max_possible: 850, score_pct: 0, score_reviews: 0, score_profile: 0, score_listings: 0,
  score_content: 0, score_web_analytics: 0, score_connections: 0, gaps, next_milestone: null,
  next_milestone_gap: null, calculated_at: null,
});

const seat = (gaps: unknown): ProfessionalSeat => ({
  pro: {
    id: "p1", display_name: "Test Pro", first_name: "Test", last_name: "Pro", slug: null, photo_url: "x",
    bio: "x", headline: "x", job_title: "x", email: null, phone: null, gcid: null, address_city: null,
    address_state: null, search_rank_score: null, claimed: true, is_demo: false, primary_org_id: null,
  },
  office: null, brand: null, score: score(gaps), ratings: [], reviews: [], nodes: [], listings: [], isDemo: false,
});

describe("scorerMoves", () => {
  test("reads the v5 shape {lane, label, marginal_pts}", () => {
    const m = scorerMoves(v5Gaps);
    expect(m.map((x) => x.points)).toEqual([68, 12.96, 0.48]);
    expect(m[0]).toEqual({
      title: "Connect and verify your Google Business Profile",
      detail: "Missing · Google Business Profile lane",
      points: 68,
      ring: "Google Business Profile",
    });
    expect(m[2].ring).toBe("Completeness");
    expect(m[2].detail).toBe("Not verified yet · Completeness lane");
  });

  test("keeps legacy v1/v2 rows {lane, action, gap: number}", () => {
    const m = scorerMoves(v2Gaps);
    expect(m).toHaveLength(2);
    expect(m[0]).toMatchObject({ title: "Fill missing profile elements", points: 123, ring: "Completeness" });
  });

  test("keeps the older string / {gap: string} shapes and drops junk", () => {
    const m = scorerMoves(["Add a headshot", { gap: "Write a bio", points: 4, ring: 1 }, null, 7, { lane: "qa" }]);
    expect(m).toHaveLength(2);
    expect(m[0]).toMatchObject({ title: "Add a headshot", points: null, ring: "Score" });
    expect(m[1]).toMatchObject({ title: "Write a bio", points: 4, ring: "Identity" });
  });

  test("non-array gaps give no moves", () => {
    expect(scorerMoves(null)).toEqual([]);
    expect(scorerMoves({ gaps: [] })).toEqual([]);
  });
});

describe("nextMoves", () => {
  test("v5 scorer gaps lead the list, in scorer order", () => {
    const moves = nextMoves(seat(v5Gaps));
    expect(moves.slice(0, 3).map((m) => m.points)).toEqual([68, 12.96, 0.48]);
  });

  test("legacy v2 gaps are no longer dropped", () => {
    const moves = nextMoves(seat(v2Gaps));
    expect(moves[0]).toMatchObject({ title: "Fill missing profile elements", points: 123 });
    expect(moves[1]).toMatchObject({ title: "Publish articles", points: 103 });
  });
});
