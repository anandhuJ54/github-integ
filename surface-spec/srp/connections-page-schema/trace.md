# Connections page trace: every value from the database to the screen

Increment: srp/connections-page-schema, task 10. Date: 2026-10-27 (the day of the run; the seed's day).

**Method.** For each of four seats `trace_expect_conn.py` read the `srp_cleanup` tables with raw SQL and its own formatting (the status lines, the powers line with the Google Business Profile lane, the summary counts, the suggestions and NORA's notes, the directories card by plan, the header sentence, the strings the page must show); it imports nothing from the API or the UI. Then:
1. **API against SQL:** logged in over HTTP as the seat's user, called `GET /srp/seat/professional/{id}/connections`, `.../srs`, `.../home`, `.../profile` and `.../website`, and compared the eleven accounts (order, key, name, state, status, powers, sync time), the summary, the suggestions, the notes and the directories card with the expectation; then compared the page with the SRS page (the GBP lane in the powers line, the Connections lane's count equal to the connected socials, the GBP gap "Connected", a video meaning YouTube connected), the Profile (a fact "From LinkedIn" meaning LinkedIn connected), Web analytics (the Indexing source following Search Console) and Home (the plan and the directories card).
2. **Page against SQL:** the expected strings were looked for in the rendered page (built-in browser, signed in through `/sign-in` as that seat's user, `/seat/professional/{id}/connections`, the first paint after about 5 s, the page's text with whitespace collapsed), and the prototype's sample values were looked for and must be absent.

**Seats.** Chosen to cover the three Home layouts, both plan kinds (the directories card shown and hidden), a seat without Search Console, and every header-sentence variant: seat 20 (user 12, day 1, core plan, Search Console and Website / CMS both unconnected: the prototype's sentence, both notes, the card), seat 34 (user 7, day 24, engage plan, Search Console connected: one suggestion, no card), seat 10 (user 34, day 7, core plan, both connected: no second sentence, no notes, the card) and seat 5 (user 18, day 24, core plan, Search Console unconnected and Website / CMS connected: one suggestion, the card).

**Result.**

| Seat (user) | Layout | Plan | Connected / matched | Header variant | API vs SQL mismatches | Page = SRS = Profile = Web = Home | Page strings expected | Found |
|---|---|---|---|---|---|---|---|---|
| 20 (user 12) | day 1 | core | 7 / 1 | both unconnected | 0 | yes | 18 | 18 |
| 34 (user 7) | day 24 | engage | 7 / 1 | Website / CMS only | 0 | yes | 15 | 15 |
| 10 (user 34) | day 7 | core | 6 / 2 | none unconnected | 0 | yes | 17 | 17 |
| 5 (user 18) | day 24 | core | 7 / 1 | Search Console only | 0 | yes | 18 | 18 |

**0 API-vs-SQL mismatches on 4 seats; 68 of 68 page strings found on the 4 seats.** None of the prototype's values (`synced today`, `67 of 68`, `4 connected, 2 matched`) appeared on any real page; the mock-data notice was shown on each.

**What the browser also showed.**
- Seat 20: clicking Connect on the first available card changed the header from "7 connected, 1 matched." to "8 connected, 1 matched." and the card's status to "Connected just now", and made no request: the network log's last request is the single `GET /api/srp/seat/professional/20/connections`.
- The page made one Connections read per visit (seat 10 and seat 20 checked in the network log); the other requests are the seat layout's existing reads (`GET .../professional/{id}`, `.../home`, `.../listings` and the `exp_office_mode` RPC). A `POST /api/search/fn/getSiteIndexing` that answers 404 comes from the shared seat layout, not from this page, and was there before this increment.
- The directories card is shown on the core-plan seats (20, 10, 5) and absent on the engage-plan seat (34), as the plan rule says.

**Negative controls.** (1) The same script with deliberately wrong expectations (the Google Business Profile status with an extra letter, the connected count plus one, the Search Console powers with an extra letter, a wrong suggestion list) reported 3 mismatches on each of the 4 seats (12 in all); the real run reports 0. (2) In the browser, four wrong strings (`8 connected, 1 matched.`, `Connect Website / CMS and I can apply your website fixes myself.`, `GBP lane (67 of 68)` and `Yelp Listing check Match found`) were all reported absent on seat 5.

**Live data.** The JOIN checks run after the seed on all 40 seats (0 violations) are in [evidence.md](./evidence.md).

## Page strings per seat (what the page had to show)

### Seat 20, day 1; core plan; both unconnected

| # | Expected on the page (from SQL) |
|---|---|
| 1 | Connections |
| 2 | Every account NORA can use, and what it powers. |
| 3 | 7 connected, 1 matched. |
| 4 | Connect Search Console and your Website / CMS and I can fix your website myself instead of handing it to your webmaster. |
| 5 | Google Business Profile GBP lane (68 of 68), hours, photos, reviews Connected · synced Oct 24 |
| 6 | Search Console Indexing and search queries for Website Analytics Part of the Google sign-in, not yet granted |
| 7 | YouTube Videos lane Connected through Google |
| 8 | Facebook Connections lane, posting Connected |
| 9 | Instagram Connections lane, posting Connected |
| 10 | LinkedIn Connections lane, photo, credentials hints Connected |
| 11 | X Connections lane Connected |
| 12 | Zillow Reviews shown on the profile |
| 13 | Yelp Listing check Match found · replies need Yelp's partner access |
| 14 | Website / CMS Lets NORA apply website fixes |
| 15 | Loan system (Encompass) Review requests after each closing Connected |
| 16 | Publish your details to Apple Maps, Bing and 28 directories. |
| 17 | Unlock with Engage, included in Amplify. |
| 18 | Unlock → |

### Seat 34, day 24; engage plan; Search Console connected

| # | Expected on the page (from SQL) |
|---|---|
| 1 | Connections |
| 2 | Every account NORA can use, and what it powers. |
| 3 | 7 connected, 1 matched. |
| 4 | Connect Website / CMS and I can apply your website fixes myself. |
| 5 | Google Business Profile GBP lane (68 of 68), hours, photos, reviews Connected · synced Oct 24 |
| 6 | Search Console Indexing and search queries for Website Analytics Connected |
| 7 | YouTube Videos lane Connected through Google |
| 8 | Facebook Connections lane, posting Connected |
| 9 | Instagram Connections lane, posting Connected |
| 10 | LinkedIn Connections lane, photo, credentials hints Connected |
| 11 | X Connections lane Connected |
| 12 | Zillow Reviews shown on the profile Matched, no sign-in needed |
| 13 | Yelp Listing check |
| 14 | Website / CMS Lets NORA apply website fixes |
| 15 | Loan system (Encompass) Review requests after each closing |

### Seat 10, day 7; core plan; both connected

| # | Expected on the page (from SQL) |
|---|---|
| 1 | Connections |
| 2 | Every account NORA can use, and what it powers. |
| 3 | 6 connected, 2 matched. |
| 4 | Google Business Profile GBP lane (27 of 68), hours, photos, reviews Connected · synced Oct 25 |
| 5 | Search Console Indexing and search queries for Website Analytics Connected |
| 6 | YouTube Videos lane Connected through Google |
| 7 | Facebook Connections lane, posting |
| 8 | Instagram Connections lane, posting |
| 9 | LinkedIn Connections lane, photo, credentials hints Connected |
| 10 | X Connections lane |
| 11 | Zillow Reviews shown on the profile Matched, no sign-in needed |
| 12 | Yelp Listing check Match found · replies need Yelp's partner access |
| 13 | Website / CMS Lets NORA apply website fixes Connected |
| 14 | Loan system (Encompass) Review requests after each closing Connected |
| 15 | Publish your details to Apple Maps, Bing and 28 directories. |
| 16 | Unlock with Engage, included in Amplify. |
| 17 | Unlock → |

### Seat 5, day 24; core plan; Search Console unconnected

| # | Expected on the page (from SQL) |
|---|---|
| 1 | Connections |
| 2 | Every account NORA can use, and what it powers. |
| 3 | 7 connected, 1 matched. |
| 4 | Connect Search Console and I can see which searches find your page. |
| 5 | Google Business Profile GBP lane (68 of 68), hours, photos, reviews Connected · synced Oct 25 |
| 6 | Search Console Indexing and search queries for Website Analytics Part of the Google sign-in, not yet granted |
| 7 | YouTube Videos lane Connected through Google |
| 8 | Facebook Connections lane, posting Connected |
| 9 | Instagram Connections lane, posting Connected |
| 10 | LinkedIn Connections lane, photo, credentials hints Connected |
| 11 | X Connections lane Connected |
| 12 | Zillow Reviews shown on the profile Matched, no sign-in needed |
| 13 | Yelp Listing check |
| 14 | Website / CMS Lets NORA apply website fixes Connected |
| 15 | Loan system (Encompass) Review requests after each closing |
| 16 | Publish your details to Apple Maps, Bing and 28 directories. |
| 17 | Unlock with Engage, included in Amplify. |
| 18 | Unlock → |
