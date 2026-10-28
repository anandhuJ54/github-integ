# Insights page trace: every value from the database to the screen

Increment: srp/insights-page-schema, task 10. Date: 2026-10-27 (the day of the run).

**Method.** For each of three seats (one per trial layout of the Home: day 1, day 7, day 24) `trace_expect_insights.py` read the `srp_cleanup` tables with raw SQL and its own formatting (thousands separators, "Mon D" dates, the seat's average map position with a "20+" cell as 21 and half-up rounding, the competitor sort, the locked-card rule, the page's lines); it imports nothing from the API or the UI. Then:
1. **API against SQL:** logged in over HTTP as the seat's user, called `GET /srp/seat/professional/{id}/insights`, `.../home` and `.../profile`, and compared the visibility figures (order, value, source line), the map (address, scan date, 49 cells with rank and each cell's three leaders), the AI block (sums and engine rows), the competitor table (places, names, ratings, reviews, averages, leader flag), the target and the locked cards with the expectation; then compared Insights with Home (map cells and top 3, scan date, AI cited and checked, the seat's rating and reviews, rival count) and with Profile (the address). It also re-checked, for every spot, that "You" is in the top 3 exactly when the rank is 1 to 3, and that each spot has three different leaders at places 1, 2 and 3.
2. **Page against SQL:** printed the strings the page must show. They were looked for in the rendered page (built-in browser, signed in through `/sign-in` as that user, `/seat/professional/{id}/insights`, the Competitors tab as it opens, then the Visibility tab). The page is read only after its first paint settles (about 4.5 s).

**Result.**

| Seat (user) | Home layout | Locked cards | API vs SQL mismatches | Insights = Home = Profile | Page strings expected | Found |
|---|---|---|---|---|---|---|
| 34 (user 7) | day 24 | 2 (plan below the top) | 0 | yes | 37 (31 compared in the browser) | 31 of 31 |
| 10 (user 34) | day 7 | 2 | 0 | yes | 35 (29 compared) | 29 of 29 |
| 20 (user 12) | day 1 | 2 | 0 | yes | 37 (29 compared) | 29 of 29 |
| 1 (user 36, API only) | day 1 | 0 (top plan "amplify") | 0 | yes | 33 | not opened in the browser |

**0 API-vs-SQL mismatches on 4 seats; 89 of 89 compared page strings found on the 3 browser seats.** (The browser comparison is a subset: repeated lines such as "Last 30 days · From Google" and "Names you for ..." notes are checked once per distinct text, and the persona-dependent header is not compared.) The fourth seat is the one plan above "core": it has no locked cards, which the first three cannot show.

None of the prototype's figures (`Alex Sample`, `1,240`, `Zillow`, `Oct 16`, `1 of 7`, `Davenport, IA 52801`) appeared on any real page. On seat 10 the `Maps views` figure is not drawn at all: that seat has no row for that metric (one seat in six misses one), so the page shows five figures, never a zero.

**What the browser also showed.** On seat 34 the office pin (spot 24) reads `You're #2 here` with `#1 Mississippi Valley Loans #2 You #3 Prairie Home Lending`; clicking the first spot changed the panel to `You're #20+ here` with `#1 Heartland Credit Union #2 Mississippi Valley Loans #3 Prairie Home Lending`, which are exactly the three stored leader rows of that spot (SQL: positions 1, 2, 3). Clicking Yes changed the question to `Got it — I'll keep Mississippi Valley Loans as your target.` and removed the buttons. Neither click made a request.

**The page made one Insights read and no write.** The network log for seat 20 shows `GET /api/srp/seat/professional/20/insights` once; the other calls are the seat layout's existing reads (`GET .../professional/20`, `.../home`, `.../listings` and the `exp_office_mode` RPC). After clicking a spot, No and the Visibility tab, no further request was made.

**Negative controls.** (1) The same script with deliberately wrong expectations (a visibility value plus one, a competitor name with an extra letter, a leader replaced by "Nobody", the AI cited count plus one) reported 4 mismatches on each of the 3 seats (12 in all); the real run reports 0. (2) In the browser, three wrong strings (`Search views 1,027`, `Named in 3 of 7 answers`, a rating line with 2.6 instead of 2.5) were all reported missing on seat 20.

## Page strings per seat (what the page had to show)

### Seat 34 (user 7), day 24

| # | Expected on the page (from SQL) |
|---|---|
| 1 | Search views 2,006 |
| 2 | Last 30 days · From Google |
| 3 | Maps views 1,656 |
| 4 | Last 30 days · From Google |
| 5 | Calls 50 |
| 6 | Last 30 days · From Google |
| 7 | Directions 12 |
| 8 | Last 30 days · From Google |
| 9 | Website clicks 21 |
| 10 | Last 30 days · From Google |
| 11 | Experience.com profile views 376 |
| 12 | Last 30 days · From Experience.com |
| 13 | Map rank around 9652 Main St |
| 14 | One-time scan · Oct 21 |
| 15 | You're #2 here |
| 16 | #1 Mississippi Valley Loans |
| 17 | #2 You |
| 18 | #3 Prairie Home Lending |
| 19 | Top 3 in 6 · 4–10 in 22 · 11–20 in 13 · 20+ in 8 |
| 20 | Named in 3 of 7 answers |
| 21 | ChatGPT 1 of 2 |
| 22 | Names you for first-time buyer questions. |
| 23 | Gemini 1 of 3 |
| 24 | Names you for first-time buyer questions. |
| 25 | Perplexity 1 of 2 |
| 26 | Names you for first-time buyer questions. |
| 27 | Is Mississippi Valley Loans who you lose deals to? |
| 28 | 1 Mississippi Valley Loans ★ 4.1 (365) 1.7 |
| 29 | 2 Heartland Credit Union ★ 4.3 (404) 4.0 |
| 30 | 3 Riverbend Bank & Trust ★ 4.4 (172) 5.8 |
| 31 | 4 Prairie Home Lending ★ 4.9 (82) 7.7 |
| 32 | 5 Bluff City Mortgage ★ 4.7 (395) 10.5 |
| 33 | 6 Harper Jones (you) ★ 4.1 (71) 11.1 |
| 34 | Map Rank tracking |
| 35 | Re-scan every week and see the day you pass Mississippi |
| 36 | AI-citation monitoring |
| 37 | Track every answer that names you |

NORA's notes (computed by the API from the same rows; they are not drawn on the first paint, so they are checked in the model and API tests): "Mississippi wins on volume." — 365 reviews and 6 articles. Your 4.1 rating is the same as their 4.1. / "Gemini names you in 1 of 3." — Names you for first-time buyer questions.

### Seat 10 (user 34), day 7

| # | Expected on the page (from SQL) |
|---|---|
| 1 | Search views 2,310 |
| 2 | Last 30 days · From Google |
| 3 | Calls 11 |
| 4 | Last 30 days · From Google |
| 5 | Directions 63 |
| 6 | Last 30 days · From Google |
| 7 | Website clicks 92 |
| 8 | Last 30 days · From Google |
| 9 | Experience.com profile views 32 |
| 10 | Last 30 days · From Experience.com |
| 11 | Map rank around 1523 Main St |
| 12 | One-time scan · Oct 23 |
| 13 | You're #2 here |
| 14 | #1 Riverbend Bank & Trust |
| 15 | #2 You |
| 16 | #3 Heartland Credit Union |
| 17 | Top 3 in 8 · 4–10 in 20 · 11–20 in 13 · 20+ in 8 |
| 18 | Named in 6 of 7 answers |
| 19 | ChatGPT 2 of 2 |
| 20 | Names you for local lender questions. |
| 21 | Gemini 2 of 3 |
| 22 | Names you for local lender questions. |
| 23 | Perplexity 2 of 2 |
| 24 | Names you for local lender questions. |
| 25 | Is Heartland Credit Union who you lose deals to? |
| 26 | 1 Heartland Credit Union ★ 4.5 (370) 3.0 |
| 27 | 2 Riverbend Bank & Trust ★ 4.4 (274) 4.3 |
| 28 | 3 Prairie Home Lending ★ 4.0 (291) 7.3 |
| 29 | 4 Bluff City Mortgage ★ 4.8 (462) 8.6 |
| 30 | 5 Mississippi Valley Loans ★ 4.8 (489) 10.4 |
| 31 | 6 Finley Singh (you) ★ 4.8 (117) 10.8 |
| 32 | Map Rank tracking |
| 33 | Re-scan every week and see the day you pass Heartland |
| 34 | AI-citation monitoring |
| 35 | Track every answer that names you |

NORA's notes (computed by the API from the same rows; they are not drawn on the first paint, so they are checked in the model and API tests): "Heartland wins on volume." — 370 reviews and 23 articles. Your 4.8 rating is better than their 4.5. / "Gemini names you in 2 of 3." — Names you for local lender questions.

### Seat 20 (user 12), day 1

| # | Expected on the page (from SQL) |
|---|---|
| 1 | Search views 1,026 |
| 2 | Last 30 days · From Google |
| 3 | Maps views 1,364 |
| 4 | Last 30 days · From Google |
| 5 | Calls 56 |
| 6 | Last 30 days · From Google |
| 7 | Directions 22 |
| 8 | Last 30 days · From Google |
| 9 | Website clicks 198 |
| 10 | Last 30 days · From Google |
| 11 | Experience.com profile views 133 |
| 12 | Last 30 days · From Experience.com |
| 13 | Map rank around 1747 Main St |
| 14 | One-time scan · Oct 20 |
| 15 | You're #2 here |
| 16 | #1 Bluff City Mortgage |
| 17 | #2 You |
| 18 | #3 Mississippi Valley Loans |
| 19 | Top 3 in 7 · 4–10 in 21 · 11–20 in 13 · 20+ in 8 |
| 20 | Named in 2 of 7 answers |
| 21 | ChatGPT 1 of 3 |
| 22 | Names you for refinance questions. |
| 23 | Gemini 1 of 2 |
| 24 | Names you for first-time buyer questions. |
| 25 | Perplexity 0 of 2 |
| 26 | Gives no answer that mentions you. |
| 27 | Is Bluff City Mortgage who you lose deals to? |
| 28 | 1 Bluff City Mortgage ★ 4.8 (370) 2.5 |
| 29 | 2 Mississippi Valley Loans ★ 4.4 (488) 4.7 |
| 30 | 3 Heartland Credit Union ★ 4.8 (148) 6.0 |
| 31 | 4 Riverbend Bank & Trust ★ 4.1 (412) 8.0 |
| 32 | 5 Reese Evans (you) ★ 4.1 (83) 10.9 |
| 33 | 6 Prairie Home Lending ★ 4.5 (425) 11.0 |
| 34 | Map Rank tracking |
| 35 | Re-scan every week and see the day you pass Bluff |
| 36 | AI-citation monitoring |
| 37 | Track every answer that names you |

NORA's notes (computed by the API from the same rows; they are not drawn on the first paint, so they are checked in the model and API tests): "Bluff wins on volume." — 370 reviews and 6 articles. Your 4.1 rating is below their 4.8. / "Perplexity never names you." — Gives no answer that mentions you.
