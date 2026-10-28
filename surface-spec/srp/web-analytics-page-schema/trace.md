# Web analytics page trace: every value from the database to the screen

Increment: srp/web-analytics-page-schema, task 10. Date: 2026-10-27 (the day of the run).

**Method.** For each of four seats (the three Home layouts, day 1, day 7 and day 24, plus a seat at the full website lane) `trace_expect_web.py` read the `srp_cleanup` tables with raw SQL and its own formatting (the points text, the counts, the tiles, the gauge, the site address and date, the snippet with its escaping and its omitted parts, NORA's notes, the page's lines); it imports nothing from the API or the UI. Then:
1. **API against SQL:** logged in over HTTP as the seat's user, called `GET /srp/seat/professional/{id}/website`, `.../srs`, `.../home` and `.../profile`, and compared the ten checks (order, state, result, points, max, points text, source, tier), the counts, the three tiles, the gauge, the site, the top fix with its snippet, NORA's notes and the facts with the expectation; then compared the page with the SRS page (the website lane's earned, max and open), Home (the Website tile's score, max and URL, and the "Fix my website" move text), the SRS gap text for the markup state, and the Profile (name, address, company); and checked that the four scored checks add up to the gauge.
2. **Page against SQL:** printed the strings the page must show. They were looked for in the rendered page (built-in browser, signed in through `/sign-in` as that user, `/seat/professional/{id}/website`, the first paint after about 5 s, the check list on its All filter) and in the gauge's accessible label.

**Result.**

| Seat (user) | Home layout | Gauge | Markup | API vs SQL mismatches | Page = SRS = Home = Profile | Page strings expected | Found |
|---|---|---|---|---|---|---|---|
| 34 (user 7) | day 24 | 62 of 102 | Partial, +11 open | 0 | yes | 24 | 24 |
| 10 (user 34) | day 7 | 55 of 102 | Partial, +32 open | 0 | yes | 24 | 24 |
| 20 (user 12) | day 1 | 75 of 102 | Partial, +16 open | 0 | yes | 24 | 24 |
| 5 (user 18) | day 24, full lane | 102 of 102 | Complete (no top fix) | 0 | yes | 18 | 18 |
| 13 (user 13, API only) | day 1 | 46 of 102 | None (0 of 42) | 0 | yes | 23 | not opened in the browser |
| 16 (user 24, API only) | day 24 | 55 of 102 | None (0 of 42) | 0 | yes | 24 | not opened in the browser |

**0 API-vs-SQL mismatches on 6 seats (after the second review's fixes and the seed re-run, below); 90 of 90 page strings found on the 4 browser seats before those fixes.** The full-lane seat has no top-fix card, no snippet, no Copy code and no Send to my webmaster, as the spec says; the two "no markup" seats (API only) show 0 of 42 and "+42 open". None of the prototype's values (`demomortgage`, `Alex Sample`, `40 of 102`, `LCP 3.1 s`, `+42 open`, `Oct 16`, `Demo Mortgage`) appeared on any real page.

**What the browser also showed.**
- Seat 20: choosing the Failing filter showed only its failing row (Reviews on site), Passing only the passing ones, and All again all ten. Send to my webmaster changed to "Sent ✓", showed the toast and the Webmaster hand-off panel.
- Seat 34: Re-check ran the progress bar through its steps and ended on "Re-check complete", "Last checked just now" and "No changes since the last scan".
- Seat 10: clicking the Indexing row opened its fix sheet with the stored result ("Indexed; no sitemap") and "Send the fix to my webmaster".
- The dates ("Last checked Apr 6", "May 11", "Jan 31", "Apr 1") are the Home seed's mock dates and several are months before 2026-10-27 (decision W20).

**The page made one Web analytics read and no write.** The network log for seat 20 shows `GET /api/srp/seat/professional/20/website` once; the other calls are the seat layout's existing reads (`GET .../professional/20`, `.../home`, `.../listings` and the `exp_office_mode` RPC). Choosing filters and sending made no further `/website` request. On seat 34, the Re-check made no request either (the last `/website` request in the log is the single read).

**Negative controls.** (1) The same script with deliberately wrong expectations (the markup points text with an extra letter, the failing count plus one, the gauge plus one, the site address with an extra letter) reported 4 mismatches on each of the 4 seats (16 in all, re-run after the fixes); the real run reports 0. (2) In the browser, four wrong strings (`Search views 1,027`, `Site health 56 of 102`, `Top fix · +33 points` and the markup row with +33) were all reported missing on seat 10.

## After the second review (re-seed and re-trace)
The second review's fixes (see [spec.md](./spec.md)) changed the seed, so the seed was re-run on `v3_local` with `--as-of 2026-10-27` (backups `~/Documents/exp-v3/seed_backup_web_fix_20261027.jsonl` and two later copies, mode 600). A further run changed 0 rows (inserted 0, updated 0, deleted 0). Then the API was restarted and `trace_expect_web.py` was extended with the new rules (Home's move and the brief's next move worth the markup's open points, the brief's website item following the markup, Security following the site's address, the Speed tile naming the metric in its result, the AI note's title by state). Before the re-seed the extended script reported 12 mismatches on the three partial-markup seats (the old move points, the old brief item and the old AI note title), which shows the new checks bite; after it:

| Check | Result |
|---|---|
| API vs SQL, 4 browser seats (34, 10, 20, 5) | 0 mismatches |
| API vs SQL, 2 API-only "no markup" seats (13, 16) | 0 mismatches |
| Live JOINs: move points = markup open, brief next move = max(1, markup open), brief website item follows the markup, Security follows the address | 0 violations over 40 seats (all addresses are https, so Security passes everywhere) |
| Browser, seat 10 re-read after the re-seed | the Speed tile now reads `Speed CLS 0.48 Failing` (the metric that sets the state), the rows, counts, top fix and snippet are unchanged, no `Speed LCP 2.6 s Failing` left |

The other browser seats were not re-read after the fixes; their expected strings changed only in the Speed tile (seat 34: `Speed CLS 0.36 Failing`; seats 20 and 5 are unchanged because all their metrics are good, so the LCP is shown) and in NORA's AI note (not drawn on the first paint).

## Page strings per seat (what the page had to show, after the fixes)

### Seat 34 (user 7), day 24; markup Partial: 31 of 42 earned (+11 open)

| # | Expected on the page (from SQL) |
|---|---|
| 1 | Website Analytics |
| 2 | example.test/seat-34 |
| 3 | Last checked May 11 |
| 4 | Site health 62 of 102 — see the checks |
| 5 | Speed CLS 0.36 Failing |
| 6 | Markup Partial +11 open |
| 7 | AI readiness 2 of 5 Needs work |
| 8 | All 10 Failing 3 Needs work 3 Passing 4 |
| 9 | Entity and markup Structured data is incomplete +11 open |
| 10 | Name, address, phone Matches the profile 30 of 30 |
| 11 | Indexing Indexed; no sitemap 1 of 20 |
| 12 | Service pages No pages for Conventional or VA loans 0 of 10 |
| 13 | Speed LCP 2.9 s (needs work), INP 132 ms, CLS 0.36 (poor) — |
| 14 | AI readiness GPTBot allowed in robots.txt; no llms.txt; no FAQ; content built by scripts; clear title and description tags — |
| 15 | Content Blog with 3 posts Pass |
| 16 | Conversion No click-to-call and no booking link — |
| 17 | Reviews on site Reviews widget installed Pass |
| 18 | Security HTTPS Pass |
| 19 | Top fix · +11 points |
| 20 | Add markup so Google and AI can read your page. |
| 21 | Send to my webmaster |
| 22 | "name": "Harper Jones – Example Home Loans", |
| 23 | "telephone": "(309) 555-7320", |
| 24 | Copy code |

NORA's notes (computed by the API from the same rows; not drawn on the first paint, so checked in the model and API tests and by the trace): "Markup is worth 11 points." — I've written the code — your webmaster only needs to paste it in. / "AI can only partly read your page." — GPTBot allowed in robots.txt; no llms.txt; no FAQ; content built by scripts; clear title and description tags.

### Seat 10 (user 34), day 7; markup Partial: 10 of 42 earned (+32 open)

| # | Expected on the page (from SQL) |
|---|---|
| 1 | Website Analytics |
| 2 | example.test/seat-10 |
| 3 | Last checked Jan 31 |
| 4 | Site health 55 of 102 — see the checks |
| 5 | Speed CLS 0.48 Failing |
| 6 | Markup Partial +32 open |
| 7 | AI readiness 2 of 5 Needs work |
| 8 | All 10 Failing 2 Needs work 5 Passing 3 |
| 9 | Entity and markup Structured data is incomplete +32 open |
| 10 | Name, address, phone Matches the profile 30 of 30 |
| 11 | Indexing Indexed; no sitemap 7 of 20 |
| 12 | Service pages Service pages for some of your loan products 8 of 10 |
| 13 | Speed LCP 2.6 s (needs work), INP 155 ms, CLS 0.48 (poor) — |
| 14 | AI readiness GPTBot allowed in robots.txt; llms.txt present; no FAQ; content built by scripts; missing title or description tags — |
| 15 | Content Blog with 5 posts Pass |
| 16 | Conversion Click-to-call yes; no booking link — |
| 17 | Reviews on site Widget not installed — |
| 18 | Security HTTPS Pass |
| 19 | Top fix · +32 points |
| 20 | Add markup so Google and AI can read your page. |
| 21 | Send to my webmaster |
| 22 | "name": "Finley Singh – Example Mortgage Group", |
| 23 | "telephone": "(309) 555-6018", |
| 24 | Copy code |

NORA's notes (computed by the API from the same rows; not drawn on the first paint, so checked in the model and API tests and by the trace): "Markup is worth 32 points." — I've written the code — your webmaster only needs to paste it in. / "AI can only partly read your page." — GPTBot allowed in robots.txt; llms.txt present; no FAQ; content built by scripts; missing title or description tags.

### Seat 20 (user 12), day 1; markup Partial: 26 of 42 earned (+16 open)

| # | Expected on the page (from SQL) |
|---|---|
| 1 | Website Analytics |
| 2 | example.test/seat-20 |
| 3 | Last checked Apr 6 |
| 4 | Site health 75 of 102 — see the checks |
| 5 | Speed LCP 1.7 s Passing |
| 6 | Markup Partial +16 open |
| 7 | AI readiness 3 of 5 Needs work |
| 8 | All 10 Failing 1 Needs work 5 Passing 4 |
| 9 | Entity and markup Structured data is incomplete +16 open |
| 10 | Name, address, phone Matches the profile 30 of 30 |
| 11 | Indexing Indexed; no sitemap 9 of 20 |
| 12 | Service pages Pages for each loan product 10 of 10 |
| 13 | Speed LCP 1.7 s, INP 146 ms, CLS 0.07 Pass |
| 14 | AI readiness GPTBot blocked in robots.txt; llms.txt present; no FAQ; content in the page HTML; clear title and description tags — |
| 15 | Content Blog with 1 post — |
| 16 | Conversion Click-to-call yes; no booking link — |
| 17 | Reviews on site Widget not installed — |
| 18 | Security HTTPS Pass |
| 19 | Top fix · +16 points |
| 20 | Add markup so Google and AI can read your page. |
| 21 | Send to my webmaster |
| 22 | "name": "Reese Evans – Example Home Loans", |
| 23 | "telephone": "(563) 555-3371", |
| 24 | Copy code |

NORA's notes (computed by the API from the same rows; not drawn on the first paint, so checked in the model and API tests and by the trace): "Markup is worth 16 points." — I've written the code — your webmaster only needs to paste it in. / "AI can only partly read your page." — GPTBot blocked in robots.txt; llms.txt present; no FAQ; content in the page HTML; clear title and description tags.

### Seat 5 (user 18), day 24, full lane; markup Complete: 42 of 42

| # | Expected on the page (from SQL) |
|---|---|
| 1 | Website Analytics |
| 2 | example.test/seat-5 |
| 3 | Last checked Apr 1 |
| 4 | Site health 102 of 102 — see the checks |
| 5 | Speed LCP 2.2 s Passing |
| 6 | Markup Complete Passing |
| 7 | AI readiness 1 of 5 Failing |
| 8 | All 10 Failing 1 Needs work 2 Passing 7 |
| 9 | Entity and markup Complete structured data on the page 42 of 42 |
| 10 | Name, address, phone Matches the profile 30 of 30 |
| 11 | Indexing Indexed with a sitemap 20 of 20 |
| 12 | Service pages Pages for each loan product 10 of 10 |
| 13 | Speed LCP 2.2 s, INP 122 ms, CLS 0.01 Pass |
| 14 | AI readiness GPTBot allowed in robots.txt; no llms.txt; no FAQ; content built by scripts; missing title or description tags — |
| 15 | Content Blog with 1 post — |
| 16 | Conversion Click-to-call yes; no booking link — |
| 17 | Reviews on site Reviews widget installed Pass |
| 18 | Security HTTPS Pass |

NORA's notes (computed by the API from the same rows; not drawn on the first paint, so checked in the model and API tests and by the trace): "AI can't read your page yet." — GPTBot allowed in robots.txt; no llms.txt; no FAQ; content built by scripts; missing title or description tags.
