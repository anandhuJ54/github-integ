# SRS page trace: every value from the database to the screen

Increment: srp/srs-page-schema, task 10. Date: 2026-10-27 (the day of the run).

**Method.** For each of three seats (one per trial layout: day 1, day 7, day 24) `trace_expect_srs.py` read the `srp_cleanup` tables with raw SQL and its own formulas (exact fractions for the Strong rule, its own sort, its own note templates; it imports nothing from the API or the UI; the script lives in the session scratch folder, outside the repo, like the Home trace's). It did two things:
1. **API against SQL:** logged in over HTTP as the seat's user, called `GET /srp/seat/professional/{id}/srs` and `.../home`, and compared total, max, open total, band and next band, rank, rival, the ten lanes (order, earned, max, open, status, you/rival text, note, action label), the counts and NORA's three notes with its own expectation, and SRS with Home (total, band, rank, rival, lane points).
2. **Page against SQL:** printed the strings the page must show. They were looked for in the rendered page (the built-in browser, signed in through `/sign-in` as that user, `/seat/professional/{id}/nora`, after the score count-up finished).

**Result.**

| Seat (user) | Layout / day | Plan | API vs SQL mismatches | Page strings expected | Page strings found |
|---|---|---|---|---|---|
| 34 (user 7) | day 24 (trial day 24) | engage | 0 | 55 | 55 (the table header `YOU VS MISSISSIPPI` is upper-cased by CSS: found case-insensitively and on a screenshot) |
| 10 (user 34) | day 7 (trial day 9) | core | 0 | 57 | 57 (the ring value 416 only after the count-up; a read before it finished showed 0) |
| 20 (user 12) | day 1 (trial day 1) | core | 0 | 57 | 57 |

**169 of 169 page strings found; 0 API-vs-SQL mismatches on 3 seats; SRS equals Home on total, band, rank, rival and lane points on all 3.**

None of the prototype's figures (`Riverbend`, `Davenport`, `#6 of 41`, `571`, `0 vs 14 articles`, `10 points to Established`) appeared on any real page. The filter chips were also read from the DOM (exact text): seat 20 `All 10, Missing 0, Fix 5, Strong 5`.

## Page strings per seat (what the page had to show)

### Seat 34, day 24

| # | Expected on the page (from SQL) |
|---|---|
| 1 | Every gap between you and the #1 lender in Bettendorf. |
| 2 | YOUR SCORE · OF 850 |
| 3 | / 850 |
| 4 | Established |
| 5 | #12 of 44 |
| 6 | in Bettendorf |
| 7 | 475 |
| 8 | 125 points to Leading |
| 9 | 600 Leading |
| 10 | Mississippi Valley Loans: 537 |
| 11 | #1 in Bettendorf · 4.1 from 365 reviews |
| 12 | Your gaps vs Mississippi |
| 13 | You vs Mississippi |
| 14 | points to #1 |
| 15 | 62 |
| 16 | points open across 10 lanes |
| 17 | 375 |
| 18 | Reviews is your biggest gap — 141 points. |
| 19 | Mississippi: 365 reviews; you have 71. Closing just this lane would take you past Leading. |
| 20 | See reviews |
| 21 | All 10 |
| 22 | Missing 1 |
| 23 | Fix 4 |
| 24 | Strong 5 |
| 25 | Reviews |
| 26 | 71 vs 365 reviews; 3 in the last 12 months |
| 27 | 46 / 187 |
| 28 | Completeness |
| 29 | Profile 94% complete, service areas missing vs a full profile with 3 designations |
| 30 | 59 / 182 |
| 31 | Website |
| 32 | No markup vs full markup |
| 33 | 48 / 102 |
| 34 | Articles |
| 35 | 0 vs 6 articles |
| 36 | 69 / 103 |
| 37 | Connections |
| 38 | 4 vs 8 connected accounts |
| 39 | 38 / 51 |
| 40 | Directories |
| 41 | 16 consistent vs 31 |
| 42 | 80 / 90 |
| 43 | GBP |
| 44 | Connected vs Connected; 7 services added |
| 45 | 68 / 68 |
| 46 | Q&A |
| 47 | 3 vs 11 answered |
| 48 | 34 / 34 |
| 49 | Videos |
| 50 | Last video 4 months old vs a video a month |
| 51 | 27 / 27 |
| 52 | Audio |
| 53 | 2 episodes vs 4 episodes |
| 54 | 6 / 6 |

### Seat 10, day 7

| # | Expected on the page (from SQL) |
|---|---|
| 1 | Every gap between you and the #1 lender in Bettendorf. |
| 2 | YOUR SCORE · OF 850 |
| 3 | / 850 |
| 4 | Established |
| 5 | #12 of 44 |
| 6 | in Bettendorf |
| 7 | 416 |
| 8 | 184 points to Leading |
| 9 | 600 Leading |
| 10 | Heartland Credit Union: 569 |
| 11 | #1 in Bettendorf · 4.5 from 370 reviews |
| 12 | Your gaps vs Heartland |
| 13 | You vs Heartland |
| 14 | points to #1 |
| 15 | 153 |
| 16 | points open across 10 lanes |
| 17 | 434 |
| 18 | Reviews is your biggest gap — 150 points. |
| 19 | Heartland: 370 reviews; you have 117. |
| 20 | See reviews |
| 21 | All 10 |
| 22 | Missing 0 |
| 23 | Fix 7 |
| 24 | Strong 3 |
| 25 | Reviews |
| 26 | 117 vs 370 reviews; 92 in the last 12 months |
| 27 | 37 / 187 |
| 28 | Completeness |
| 29 | Profile 76% complete, service areas missing vs a full profile with 3 designations |
| 30 | 76 / 182 |
| 31 | Website |
| 32 | Partial markup vs full markup |
| 33 | 54 / 102 |
| 34 | GBP |
| 35 | Connected vs Connected; 3 services added |
| 36 | 27 / 68 |
| 37 | Directories |
| 38 | 9 consistent vs 23 |
| 39 | 51 / 90 |
| 40 | Articles |
| 41 | 1 vs 23 articles |
| 42 | 72 / 103 |
| 43 | Connections |
| 44 | 1 vs 2 connected accounts |
| 45 | 32 / 51 |
| 46 | Q&A |
| 47 | 2 vs 18 answered |
| 48 | 34 / 34 |
| 49 | Videos |
| 50 | Last video 16 months old vs a video a month |
| 51 | 27 / 27 |
| 52 | Audio |
| 53 | No audio vs 5 episodes |
| 54 | 6 / 6 |

### Seat 20, day 1

| # | Expected on the page (from SQL) |
|---|---|
| 1 | Every gap between you and the #1 lender in Rock Island. |
| 2 | YOUR SCORE · OF 850 |
| 3 | / 850 |
| 4 | Building |
| 5 | #11 of 35 |
| 6 | in Rock Island |
| 7 | 399 |
| 8 | 1 points to Established |
| 9 | 400 Established |
| 10 | Bluff City Mortgage: 523 |
| 11 | #1 in Rock Island · 4.8 from 370 reviews |
| 12 | Your gaps vs Bluff |
| 13 | You vs Bluff |
| 14 | points to #1 |
| 15 | 124 |
| 16 | points open across 10 lanes |
| 17 | 451 |
| 18 | Reviews is your biggest gap — 143 points. |
| 19 | Bluff: 370 reviews; you have 83. Closing just this lane would take you past Established. |
| 20 | See reviews |
| 21 | All 10 |
| 22 | Missing 0 |
| 23 | Fix 5 |
| 24 | Strong 5 |
| 25 | Reviews |
| 26 | 83 vs 370 reviews; 61 in the last 12 months |
| 27 | 44 / 187 |
| 28 | Completeness |
| 29 | Profile 69% complete, service areas missing vs a full profile with 3 designations |
| 30 | 45 / 182 |
| 31 | Articles |
| 32 | 4 vs 6 articles |
| 33 | 28 / 103 |
| 34 | Directories |
| 35 | 8 consistent vs 21 |
| 36 | 41 / 90 |
| 37 | Website |
| 38 | No markup vs full markup |
| 39 | 68 / 102 |
| 40 | Connections |
| 41 | 4 vs 8 connected accounts |
| 42 | 44 / 51 |
| 43 | GBP |
| 44 | Connected vs Connected; 2 services added |
| 45 | 62 / 68 |
| 46 | Q&A |
| 47 | 2 vs 6 answered |
| 48 | 34 / 34 |
| 49 | Videos |
| 50 | No videos vs a video a month |
| 51 | 27 / 27 |
| 52 | Audio |
| 53 | No audio vs 8 episodes |
| 54 | 6 / 6 |

## NORA's three notes (not drawn on the page: the NORA chat UI is switched off in the prototype, `HF_NORA_UI`)

They are part of the model and the API response, so they were checked API against SQL only:

| Seat | Note 1 | Note 2 | Note 3 |
|---|---|---|---|
| 20 | Reviews gets you to Established. It's 143 points open, and you only need 1 to cross 400. | Your Completeness is costing you 137 points. Bluff City Mortgage: a full profile with 3 designations. You: Profile 69% complete, service areas missing. | Q&A is already strong. 2 |
| 10 | Reviews is your biggest gap. It's 150 points open. | Your Completeness is costing you 106 points. Heartland Credit Union: a full profile with 3 designations. You: Profile 76% complete, service areas missing. | Q&A is already strong. 2 |
| 34 | Reviews gets you to Leading. It's 141 points open, and you only need 125 to cross 600. | Your Completeness is costing you 123 points. Mississippi Valley Loans: a full profile with 3 designations. You: Profile 94% complete, service areas missing. | GBP is already strong. 7 services added |

## Negative controls

- **Page check:** 7 deliberately wrong strings (`#12 of 35`, `398`, `2 points to Established`, `Bluff City Mortgage: 524`, `Strong 4`, `44 / 188`, `Riverbend Bank & Trust: 571`) were looked for on seat 20's page: 6 were not there (caught). `Strong 4` was found because it is a substring of `Strong 44 / 187` (a lane status followed by its points): a weakness of substring matching, so the chip counts were then read from the DOM buttons exactly (above).
- **API check:** the expectation script was rerun with two wrong formulas (a 70% Strong threshold, and the Missing flag inverted): it reported 6 mismatches on seat 20 and 8 on seat 10 (statuses and counts), and exited with them listed.

## Findings from the trace

1. **Wording, fixed:** "1 points to Established" (seat 20 needs 1 point). The notes, greeting, callout and band pill now say "1 point"; tests first on both sides (Python notes, `srsModel` greeting and callout, the pill).
2. **Mock text quirks, recorded not fixed:** Completeness text says "service areas missing" at 94% profile strength; Articles shows `0 vs 6 articles` with 69 of 103 points earned. They are independent mock values (decision N4 says `is_missing` is a stored fact), so the page can show odd pairs until a real source exists.
3. **A bare number as a note body, recorded not fixed:** "Q&A is already strong. 2" (the lane's `you_text` is `2` with no unit). The spec says the body is the lane's note or its `you_text`; a better body needs a ruling on lane texts with units.
4. **Count-up reads:** while the tab is in the background the score count-up does not advance (a read then shows 0); reads must follow a foreground screenshot and the 1.2 s animation.

## Re-run after the seed fix (second review finding 1)

The independent review found that 49 of 61 lanes flagged `is_missing` earned at least 75% of their budget, so the page showed them as Strong. After the seed plan fix (a lane the seat has none of earns 0 points), the seed was re-run on `v3_local` (`--as-of 2026-10-27`, backup `~/Documents/exp-v3/seed_backup_srs_fix_20261027.jsonl`, mode 600): **inserted 0, updated 916, deleted 0**; second run 0, 0, 0. Only lane points changed; the sum of all snapshot totals is unchanged (47,183 over 122 snapshots), every snapshot's lane points still add to its total and stay within budget, and no table's row count changed.

| Check | Result |
|---|---|
| `is_missing` lanes that earn points on any snapshot | 0 (was 49 of 61 at Strong or above on the newest snapshots) |
| Missing-flagged lanes at Strong, by lane (Articles 14, Q&A 13, Videos 14, Audio 20 flagged) | 0 in every lane |
| Articles missing against the Home brief's first-article flag | 0 mismatches |
| API vs independent SQL on seats 20, 10, 34 | 0 mismatches on all 3; SRS equals Home on total, band, rank, rival, lane points |
| Page strings found (seat 20: 54 of 55, seat 10: 55 of 56, seat 34: 54 of 54) | 163 of 165; the two not found are layout labels, not values: `YOU VS BLUFF` (the table header, drawn only in the wide layout) and `Fix · locked` (the narrow list layout shows `Locked`, which was found) |
| Chips read from the DOM | seat 20 `All 10, Missing 2, Fix 5, Strong 3`; seat 10 `Missing 1, Fix 7, Strong 2`; seat 34 `Missing 1, Fix 3, Strong 6` |
| The prototype's figures on a real page | none |

Side effects of the re-run: Home's per-lane figures moved with the lane points (for example the points waiting behind locked features); Home totals, bands, ranks and rivals did not. The "1 points" wording is now "1 point" (seat 20 reads "1 point to Established").
