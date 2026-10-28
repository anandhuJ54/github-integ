"""Pydantic models for the seat resource."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class SrpRpcArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    args: dict[str, Any] = Field(default_factory=dict)


# --- GET /srp/seat/professional/{pro_id}/home (srp/home-page-schema) ---------------------------------------
# Every value is stored or computed from stored rows; a section is None when there is nothing to show (`ready` false: all of them).
# Timestamps are ISO strings.


class HomeDay(BaseModel):
    n: int
    trial_days: int
    layout: Literal["day1", "day7", "day24"]
    over: bool


class HomePerson(BaseModel):
    first_name: str | None
    full_name: str | None
    title: str | None
    photo_url: str | None
    year_started: int | None
    credentials: int


class HomePlanRef(BaseModel):
    key: str
    name: str
    tag: str | None


class HomeTrial(BaseModel):
    plan: HomePlanRef
    started_at: str | None
    nora_text_day: str | None


class HomeBandRef(BaseModel):
    name: str
    min_points: int


class HomeBand(BaseModel):
    name: str
    min_points: int
    next: HomeBandRef | None


class HomeLane(BaseModel):
    key: str
    name: str
    points: int | None
    max: int


class HomeScore(BaseModel):
    total: int
    max: int | None
    band: HomeBand | None
    as_of: str | None
    since_claim: int | None
    week_delta: int | None
    lanes: list[HomeLane]


class HomeRank(BaseModel):
    position: int
    of: int
    city: str | None
    first_position: int | None


class HomeRival(BaseModel):
    name: str
    initial: str
    score: int
    points_to_first: int
    review_count: int | None
    review_avg: float | None
    article_count: int | None


class HomeCompetitors(BaseModel):
    count: int


class HomeLatest(BaseModel):
    label: str
    points: int | None
    status: Literal["doing", "done"]
    started_at: str | None
    completed_at: str | None


class HomeDone(BaseModel):
    label: str
    points: int | None


class HomeMove(BaseModel):
    icon: str
    title: str
    subtitle: str | None
    recommended: bool
    target: Literal["voce", "website", "profile"]
    points: int | None


class HomeMoves(BaseModel):
    done: int
    goal: int


class HomeBoard(BaseModel):
    latest: HomeLatest | None
    done: list[HomeDone]
    done_count: int
    since_claim_points: int
    next_moves: list[HomeMove]
    moves: HomeMoves
    streak_weeks: int
    needs_you_count: int


class HomeCell(BaseModel):
    row: int
    col: int
    rank: int | None


class HomeMap(BaseModel):
    scanned_at: str | None
    top3: int
    total: int
    cells: list[HomeCell]


class HomeAiTile(BaseModel):
    cited: int | None
    checked: int
    checked_at: str | None


class HomeReviewsTile(BaseModel):
    avg: float | None
    count: int | None
    as_of: str | None


class HomeProfileStrength(BaseModel):
    pct: int | None
    previous_pct: int | None


class HomeWebsiteTile(BaseModel):
    score: int | None
    max: int | None
    url: str | None


class HomeArticles(BaseModel):
    published: int
    total: int


class HomeTiles(BaseModel):
    map: HomeMap | None
    ai: HomeAiTile | None
    reviews: HomeReviewsTile
    profile_strength: HomeProfileStrength
    website: HomeWebsiteTile | None
    articles: HomeArticles


class HomeLockedFeature(BaseModel):
    key: str
    title: str
    description: str | None
    points_waiting: int | None
    plan: str


class HomeLocked(BaseModel):
    features: list[HomeLockedFeature]
    points_waiting: int


class HomePeers(BaseModel):
    band_from: str
    median_gain: int
    horizon_days: int
    cohort_size: int
    cohort_period: str
    reached_next_band: int
    of: int


class HomeBriefItem(BaseModel):
    label: str
    points: int | None


class HomeNextMove(BaseModel):
    label: str | None
    points: int | None
    target: str | None


class HomeAway(BaseModel):
    new_reviews: int
    bio_live: bool
    first_article: bool


class HomeBrief(BaseModel):
    week_start: str | None
    points_total: int
    items: list[HomeBriefItem]
    next_move: HomeNextMove
    away: HomeAway


class HomeDraft(BaseModel):
    id: int
    reviewer_label: str
    rating: int
    review_text: str
    draft_text: str
    compliance_status: Literal["passed", "needs_edit"]
    status: Literal["draft", "approved", "posted"]


class HomeEvent(BaseModel):
    kind: Literal["review", "facebook"]
    title: str
    body: str | None
    action_label: str | None
    expires_at: str | None


class HomeInsight(BaseModel):
    position: int
    title: str
    body: str
    cta: str | None
    action: Literal["voce", "reviews", "insights"]


class HomeRecapTile(BaseModel):
    label: str
    from_: int = Field(alias="from")
    to: int
    delta: int

    model_config = ConfigDict(populate_by_name=True)


class HomeRecap(BaseModel):
    days: int
    things_done: int
    tiles: list[HomeRecapTile]
    articles: int
    replies: int


class HomePlan(BaseModel):
    key: str
    name: str
    tag: str | None
    highlight: bool
    items: list[str]


class HomeResponse(BaseModel):
    as_of: str
    data: Literal["mock", "live"] | None
    ready: bool
    day: HomeDay | None
    person: HomePerson | None
    trial: HomeTrial | None
    score: HomeScore | None
    rank: HomeRank | None
    rival: HomeRival | None
    competitors: HomeCompetitors | None
    board: HomeBoard | None
    tiles: HomeTiles | None
    locked: HomeLocked | None
    peers: HomePeers | None
    brief: HomeBrief | None
    drafts: list[HomeDraft] | None
    events: list[HomeEvent] | None
    insights: list[HomeInsight] | None
    recap: HomeRecap | None
    plans: list[HomePlan] | None


# --- the SRS page (srp/srs-page-schema) ---------------------------------------------------------------------

class SrsBandNext(BaseModel):
    name: str
    min_points: int
    points_needed: int


class SrsBand(BaseModel):
    name: str
    min_points: int
    next: SrsBandNext | None


class SrsScore(BaseModel):
    total: int
    max: int | None
    open_total: int | None
    as_of: str | None
    band: SrsBand | None


class SrsRank(BaseModel):
    position: int
    of: int
    city: str | None


class SrsRival(BaseModel):
    name: str
    score: int
    points_to_first: int
    review_count: int | None
    review_avg: float | None


SrsStatus = Literal["Missing", "Fix", "Fix · locked", "Strong"]


class SrsLane(BaseModel):
    key: str
    name: str
    short_name: str | None
    earned: int | None
    max: int
    open: int | None
    status: SrsStatus | None
    you_text: str | None
    rival_text: str | None
    note: str | None
    action_label: str | None
    action_target: Literal["profile", "voce", "website", "connections", "reviews", "chat", "billing"] | None


class SrsCounts(BaseModel):
    all: int
    missing: int
    fix: int
    strong: int


class SrsNote(BaseModel):
    title: str
    body: str
    cta: str | None
    action: str | None


class SrsResponse(BaseModel):
    as_of: str
    data: Literal["mock", "live"] | None
    ready: bool
    score: SrsScore | None
    rank: SrsRank | None
    rival: SrsRival | None
    lanes: list[SrsLane] | None
    counts: SrsCounts | None
    notes: list[SrsNote] | None


# --- the Profile page (srp/profile-page-schema) -------------------------------------------------------------

ProfileField = Literal["name", "title", "photo", "bio", "year_started", "office_phone", "mobile_phone", "email", "address", "hours", "nmls", "licensed_in",
                       "products", "service_areas", "designations", "awards", "education", "company"]
ProfileTier = Literal["self_declared", "imported", "platform_observed", "authority_verified", "owner_verified"]


class ProfileFact(BaseModel):
    field: ProfileField
    present: bool
    value: str | list[str] | None
    source: str | None
    trust_tier: ProfileTier | None
    confirmed_at: str | None
    source_line: str | None


class ProfilePreview(BaseModel):
    title: str | None
    company: str | None
    city: str | None
    rating: float | None
    reviews: int | None
    nmls: str | None
    strength_pct: int | None
    photo_url: str | None


class ProfileCredentials(BaseModel):
    added: int
    of: int


class ProfileGraphGroup(BaseModel):
    key: Literal["identity", "contact", "licence", "products", "reviews", "presence"]
    facts: int


class ProfileGraph(BaseModel):
    groups: list[ProfileGraphGroup]
    facts_total: int
    sources: int


class ProfileResponse(BaseModel):
    as_of: str
    data: Literal["mock", "live"] | None
    ready: bool
    facts: list[ProfileFact] | None
    preview: ProfilePreview | None
    credentials: ProfileCredentials | None
    graph: ProfileGraph | None


# --- the Insights page (srp/insights-page-schema) -----------------------------------------------------------

InsightsMetric = Literal["search_views", "maps_views", "calls", "directions", "website_clicks", "profile_views"]
InsightsEngineName = Literal["chatgpt", "gemini", "perplexity"]


class InsightsVisibility(BaseModel):
    metric: InsightsMetric
    value: int
    period_days: int
    source: str
    trust_tier: ProfileTier
    source_line: str


class InsightsLeader(BaseModel):
    position: int
    name: str | None
    is_you: bool


class InsightsCell(BaseModel):
    row: int
    col: int
    rank: int | None
    leaders: list[InsightsLeader]


class InsightsMap(BaseModel):
    address: str | None
    scanned_at: str | None
    spots: int
    top3: int
    cells: list[InsightsCell]


class InsightsEngine(BaseModel):
    engine: InsightsEngineName
    cited: int
    checked: int
    note: str | None


class InsightsAi(BaseModel):
    cited: int
    checked: int
    engines: list[InsightsEngine]


class InsightsCompetitor(BaseModel):
    place: int
    name: str
    is_you: bool
    rating: float | None
    reviews: int | None
    avg_position: float | None
    is_leader: bool


class InsightsTarget(BaseModel):
    name: str


class InsightsLocked(BaseModel):
    key: Literal["map_rank_tracking", "ai_citation_monitoring"]
    title: str
    text: str


class InsightsNote(BaseModel):
    title: str
    body: str
    cta: str
    action: str


class InsightsResponse(BaseModel):
    as_of: str
    data: Literal["mock", "live"] | None
    ready: bool
    visibility: list[InsightsVisibility] | None
    map: InsightsMap | None
    ai: InsightsAi | None
    competitors: list[InsightsCompetitor] | None
    target: InsightsTarget | None
    locked: list[InsightsLocked] | None
    notes: list[InsightsNote] | None


# --- the Web analytics page (srp/web-analytics-page-schema) -------------------------------------------------

WebCheckKey = Literal["entity_markup", "nap", "indexing", "service_pages", "speed", "ai_readiness", "content", "conversion", "reviews_on_site", "security"]
WebState = Literal["fail", "warn", "pass"]


class WebSite(BaseModel):
    url: str | None
    last_checked: str | None


class WebHealth(BaseModel):
    earned: int
    max: int
    open: int


class WebCheck(BaseModel):
    key: WebCheckKey
    group: str
    state: WebState
    result: str
    points: int | None
    max: int | None
    points_text: str
    source: str
    trust_tier: ProfileTier


class WebCounts(BaseModel):
    all: int
    fail: int
    warn: int
    pass_: int = Field(alias="pass")

    model_config = ConfigDict(populate_by_name=True)


class WebTile(BaseModel):
    key: Literal["speed", "markup", "ai_readiness"]
    label: str
    value: str
    note: str
    state: WebState
    check: WebCheckKey


class WebTopFix(BaseModel):
    open: int
    snippet: str | None


class WebNote(BaseModel):
    title: str
    body: str
    cta: str
    action: Literal["send", "close"]


class WebFacts(BaseModel):
    name: str | None
    company: str | None
    phone: str | None
    address: str | None


class WebAnalyticsResponse(BaseModel):
    as_of: str
    data: Literal["mock", "live"] | None
    ready: bool
    site: WebSite | None
    health: WebHealth | None
    checks: list[WebCheck] | None
    counts: WebCounts | None
    tiles: list[WebTile] | None
    top_fix: WebTopFix | None
    notes: list[WebNote] | None
    facts: WebFacts | None


ConnectionKey = Literal["google_business", "search_console", "youtube", "facebook", "instagram", "linkedin", "x", "zillow", "yelp", "website_cms", "loan_system"]


class ConnectionAccount(BaseModel):
    key: ConnectionKey
    name: str
    state: Literal["connected", "available", "matched", "partial"]
    status: str
    powers: str
    synced_at: str | None


class ConnectionSummary(BaseModel):
    connected: int
    matched: int


class ConnectionSuggest(BaseModel):
    key: ConnectionKey
    name: str


class ConnectionNote(BaseModel):
    title: str
    body: str
    cta: str
    connect: ConnectionKey


class ConnectionLocked(BaseModel):
    title: str
    text: str


class ConnectionsResponse(BaseModel):
    as_of: str
    data: Literal["mock", "live"] | None
    ready: bool
    accounts: list[ConnectionAccount] | None
    summary: ConnectionSummary | None
    suggest: list[ConnectionSuggest] | None
    notes: list[ConnectionNote] | None
    locked: ConnectionLocked | None
