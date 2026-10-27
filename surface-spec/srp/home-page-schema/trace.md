# Home page trace: every number from the database to the screen

Increment: srp/home-page-schema, task 14. Date: 2026-10-27 (the day of the run; trial days are relative to it).

**Method.** For each of three seats (one per layout) the expected strings were computed by `trace_expect.py` straight from the `srp_cleanup` tables with its own formulas (no code from the API or the UI; the script lives in the session scratchpad, and the SQL each row uses is named below). The browser (built-in, `http://127.0.0.1:5173`, signed in at `/sign-in` as the seat's owner with the local sign-in) was then asked, by a script on the page, whether each expected string appears in the page text (`document.body.innerText`, whitespace collapsed). The start year is checked on the selected option of the year picker. Day 1 was read after the first-task count-up finished.

**Result: 104 of 104 expected values found** (Day 24: 39, Day 7: 33, Day 1: 32), plus the peer card (read against the SQL separately, a full match).

## Day 24: seat 34 (user 7), trial day 24

| Item | Shown on the page | Source (SQL) | Result |
|---|---|---|---|
| notice | Mock data · these values come from the local database and are not your real score or activity. | home_seat_state.is_mock | Found |
| trial chip | Day 24 of 30 | home_seat_state.trial_started_at, today, trial_days | Found |
| banner day | Trial · day 24 of 30. | same | Found |
| banner locked list | Map Rank tracking is locked | home_locked_features whose plan position > seat plan position | Found |
| banner points | Map Rank tracking is locked. | sum(lane max - snapshot lane points) over locked features | Found |
| score total | 475 | latest home_snapshots.total | Found |
| ring max | / 850 | home_score_lanes sum(max_points) | Found |
| band pill | You're Established | home_score_bands highest min <= total | Found |
| week delta | ▲ 67 this week | latest total - newest snapshot >= 7 days older (else earliest) | Found |
| rank line | #12 of 44 in Bettendorf | latest home_snapshots rank_* | Found |
| band note | Next band: Leading at 600. | next home_score_bands row | Found |
| map tile | 6 of 49 | home_map_cells of latest snapshot, rank<=3 | Found |
| map date | Last scan Oct 21 | home_snapshots.map_scanned_at | Found |
| ai tile | 3 of 7 | home_snapshots.ai_cited/ai_checked | Found |
| ai date | Last check Oct 27 | home_snapshots.ai_checked_at | Found |
| reviews avg | 4.1 | home_snapshots.review_avg | Found |
| reviews count | from 71 reviews | home_snapshots.review_count | Found |
| profile strength | 94% | home_snapshots.profile_strength_pct | Found |
| profile prev | up from 77% | week snapshot profile_strength_pct | Found |
| moves | 2 of 3 moves this week | home_seat_state.moves_* | Found |
| streak | Streak · 2 weeks | home_seat_state.streak_weeks | Found |
| brief total | Up 67 this week | sum(home_weekly_brief_items.points) | Found |
| brief item 1 | Website markup fixed +20 | home_weekly_brief_items | Found |
| brief item 2 | First article published (VOCE free credits) +8 | home_weekly_brief_items | Found |
| brief item 3 | Photo added +12 | home_weekly_brief_items | Found |
| brief item 4 | Service areas added +16 | home_weekly_brief_items | Found |
| brief item 5 | 2 replies posted +11 | home_weekly_brief_items | Found |
| next move | Fix my website · +54 | home_weekly_briefs | Found |
| away line | Nothing new while you were away. | home_weekly_briefs.away_* | Found |
| needs you | Needs you 2 | count(home_review_drafts status=draft) | Found |
| draft 86 | Reviewer A. (mock) | home_review_drafts | Found |
| draft text 86 | It took longer than promised, but we got there. | home_review_drafts | Found |
| draft 87 | Reviewer B. (mock) | home_review_drafts | Found |
| draft text 87 | Made the whole process easy. Highly recommend. | home_review_drafts | Found |
| year default | 2008 | tier_agents.year_started (selected option) | Found |
| recap heading | In 24 days I did 6 things for you. | trial day, count(done activities) | Found |
| recap score | 282 → 475 | first and latest snapshot totals | Found |
| recap rank | #22 → #12 | first and latest rank | Found |
| recap profile | 45% → 94% | first and latest profile strength | Found |

## Day 7: seat 10 (user 34), trial day 9

| Item | Shown on the page | Source (SQL) | Result |
|---|---|---|---|
| notice | Mock data · these values come from the local database and are not your real score or activity. | home_seat_state.is_mock | Found |
| trial chip | Day 9 of 30 | home_seat_state.trial_started_at, today, trial_days | Found |
| banner day | Trial · day 9 of 30. | same | Found |
| banner locked list | Listings, VOCE and Map Rank tracking are locked | home_locked_features whose plan position > seat plan position | Found |
| banner points | 70 points are waiting behind them | sum(lane max - snapshot lane points) over locked features | Found |
| score total | 416 | latest home_snapshots.total | Found |
| ring max | / 850 | home_score_lanes sum(max_points) | Found |
| band pill | You're Established | home_score_bands highest min <= total | Found |
| week delta | ▲ 45 this week | latest total - newest snapshot >= 7 days older (else earliest) | Found |
| rank line | #12 of 44 in Bettendorf | latest home_snapshots rank_* | Found |
| band note | Next band: Leading at 600. | next home_score_bands row | Found |
| map tile | 8 of 49 | home_map_cells of latest snapshot, rank<=3 | Found |
| map date | Last scan Oct 23 | home_snapshots.map_scanned_at | Found |
| ai tile | 6 of 7 | home_snapshots.ai_cited/ai_checked | Found |
| ai date | Last check Oct 27 | home_snapshots.ai_checked_at | Found |
| reviews avg | 4.8 | home_snapshots.review_avg | Found |
| reviews count | from 117 reviews | home_snapshots.review_count | Found |
| profile strength | 76% | home_snapshots.profile_strength_pct | Found |
| profile prev | up from 66% | week snapshot profile_strength_pct | Found |
| moves | 2 of 3 moves this week | home_seat_state.moves_* | Found |
| streak | Streak · 1 week | home_seat_state.streak_weeks | Found |
| brief total | Up 45 this week | sum(home_weekly_brief_items.points) | Found |
| brief item 1 | 2 replies posted +12 | home_weekly_brief_items | Found |
| brief item 2 | Website markup fixed +9 | home_weekly_brief_items | Found |
| brief item 3 | Service areas added +7 | home_weekly_brief_items | Found |
| brief item 4 | Photo added +9 | home_weekly_brief_items | Found |
| brief item 5 | Bio approved +8 | home_weekly_brief_items | Found |
| next move | Fix my website · +48 | home_weekly_briefs | Found |
| away line | While you were away: 1 new review, your bio went live and your first article is published. | home_weekly_briefs.away_* | Found |
| needs you | Needs you 1 | count(home_review_drafts status=draft) | Found |
| draft 23 | Reviewer A. (mock) | home_review_drafts | Found |
| draft text 23 | Fine overall. Communication could have been better. | home_review_drafts | Found |
| year default | 2009 | tier_agents.year_started (selected option) | Found |

## Day 1: seat 20 (user 12), trial day 1

| Item | Shown on the page | Source (SQL) | Result |
|---|---|---|---|
| notice | Mock data · these values come from the local database and are not your real score or activity. | home_seat_state.is_mock | Found |
| trial chip | Day 1 of 30 | home_seat_state.trial_started_at, today, trial_days | Found |
| banner day | Trial · day 1 of 30. | same | Found |
| banner locked list | Listings, VOCE and Map Rank tracking are locked | home_locked_features whose plan position > seat plan position | Found |
| banner points | 124 points are waiting behind them | sum(lane max - snapshot lane points) over locked features | Found |
| score total | 399 | latest home_snapshots.total | Found |
| map tile | 7 of 49 | home_map_cells of latest snapshot, rank<=3 | Found |
| ai tile | 2 of 7 | home_snapshots.ai_cited/ai_checked | Found |
| reviews avg | 4.1 | home_snapshots.review_avg | Found |
| reviews count | from 83 reviews | home_snapshots.review_count | Found |
| profile strength | 69% | home_snapshots.profile_strength_pct | Found |
| moves | 0 of 3 moves this week | home_seat_state.moves_* | Found |
| hero day | DAY 1 OF 30 | trial dates | Found |
| hero rival | Pass Bluff City Mortgage | max(home_competitors.score) > total | Found |
| rival score | Bluff 523 | home_competitors.score | Found |
| points to #1 | 124 points to #1 | rival score - total (after the count-up) | Found |
| hero rank | You're #11 of 35 | latest snapshot | Found |
| since claim | ▲ 83 since you claimed | latest total - claim snapshot total | Found |
| done count | DONE · 10 THINGS | count(home_activity status=done) | Found |
| task label | Adding your Google category and services | latest home_activity | Found |
| up next 1 | Start publishing | home_next_moves | Found |
| up next sub 1 | Your biggest gap: articles. Bluff City Mortgage has 6. Free VOCE credits. | home_next_moves | Found |
| up next 2 | Fix my website | home_next_moves | Found |
| up next sub 2 | Markup is missing on your site | home_next_moves | Found |
| up next 3 | Add your credentials | home_next_moves | Found |
| up next sub 3 | Certifications and awards for your profile | home_next_moves | Found |
| locked listings | Listings | home_locked_features | Found |
| locked pts listings | +49 | lane max - lane points | Found |
| locked voce | VOCE | home_locked_features | Found |
| locked pts voce | +75 | lane max - lane points | Found |
| locked map_rank | Map Rank tracking | home_locked_features | Found |
| done points | +83 points since you claimed | sum(points of done activities) — see note | Found |

## Peer card (Day 1 seat 20, after the task finishes)
Page: "+61 median points in 90 days · 3 of 5 reached the next band · Based on 34 loan officers who started at Building, Jan–Sep 2026". SQL: `home_peer_benchmarks` joined to the band of the seat's first snapshot total (Building) gives `+61 | 90 | 3 of 5 | 34 | Building | Jan–Sep 2026`. Match.

## Negative controls
1. **Another seat's expectations against this page.** Fifteen values of seat 10 (Day 7) checked on seat 34's page (Day 24): 12 not found; the three found are values the two seats really share ("2 of 3 moves this week", the mock-data notice, "/ 850"). The checker does tell seats apart.
2. **One-off values.** "476" instead of 475, "▲ 68 this week" instead of 67 and "#13 of 44" instead of "#12 of 44" on seat 34's page: none found.
3. **Not your seat.** User 34 opened seat 34 (owned by user 7): the API answers 403 and the page showed the prototype's sample (Riverbend, Alex, "Sample data" notice) with none of seat 34's values (475, Bettendorf, Mock data). No data leaked across users.

## What this trace does not prove
- The expectations come from the same author's reading of the rules (band edges, the week-ago snapshot rule, locked-feature waiting points, done count), so a misreading of a rule in both places would not show. The rules are written in `spec.md` and were reviewed in task 7; task 15 reviews them again with a second model.
- The first-task count-up was read after it finished. While the browser tab was in the background the count-up stalled (browsers pause animation frames): the page showed 396 and "127 points to #1" next to the "Done" banner, and once the tab was visible it ended at 399 and 124. That is how the animation behaves, but the final value depends on the tab being visible.
- Only three seats of the 30 or more seeded were traced; the others are covered by the real-Postgres tests and the seed invariants, not by the browser.
- Mobile layout, reduced motion and the interior copy of the Compare-plans window were not traced here (the Day 24 recap window was).
