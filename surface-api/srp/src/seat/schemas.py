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
