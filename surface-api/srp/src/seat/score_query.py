"""One place that reads a seat's score rows, so the seat read and the Home read cannot disagree (srp/home-page-data).

The score is the sum of the non-null `user_search_rank_scores.srs_category_score` rows; a seat whose scores are all NULL has an
*unknown* total (None), not 0. The configuration these scores come from is the cleanup schema's legacy one, not SRS v5.

Per (seat, category) only the NEWEST row counts (a seat can have several, one per zipcode or per refresh), and a row whose category
is not in the configuration is ignored, so the total can never exceed what the categories allow and a category is never listed twice.
"""
from __future__ import annotations

from typing import Any


def scores_sql(schema: str) -> str:
    return f"""select distinct on (s.srs_config_category_id)
                       s.srs_config_category_id as category_id, c.display_name as name, s.srs_category_score as score,
                       c.score as max, s.zipcode, s.vertical_id, s.updated_at
                from {schema}.user_search_rank_scores s
                join {schema}.srs_config_categories c on c.id = s.srs_config_category_id
                where s.tier_agent_id = %s
                order by s.srs_config_category_id, s.updated_at desc nulls last, s.id desc"""


def fetch_scores(conn: Any, schema: str, seat_id: int) -> list[dict[str, Any]]:
    return list(conn.execute(scores_sql(schema), (seat_id,)).fetchall())


def total_of(rows: list[dict[str, Any]]) -> int | None:
    known = [int(r["score"]) for r in rows if r["score"] is not None]
    return sum(known) if known else None


def latest_update(rows: list[dict[str, Any]]) -> Any:
    stamps = [r["updated_at"] for r in rows if r["updated_at"] is not None]
    return max(stamps) if stamps else None
