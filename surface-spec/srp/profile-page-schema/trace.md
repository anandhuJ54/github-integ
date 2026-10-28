# Profile page trace: every value from the database to the screen

Increment: srp/profile-page-schema, task 10. Date: 2026-10-27 (the day of the run).

**Method.** For each of three seats (one per trial layout of the Home: day 1, day 7, day 24) `trace_expect_profile.py` read the `srp_cleanup` tables with raw SQL and its own formatting (phone format, "Mon D" dates, the thin-bio limit, the preview line, the group totals); it imports nothing from the API or the UI and lives in the session scratch folder, outside the repo. It did two things:
1. **API against SQL:** logged in over HTTP as the seat's user, called `GET /srp/seat/professional/{id}/profile` and `.../home`, and compared all 18 facts (order, presence, value, source line, tier), credentials, graph groups and totals, the preview, and the preview's rating, reviews, strength and city with Home's.
2. **Page against SQL:** printed the strings the page must show and the number of rows that must say "Not found anywhere yet". They were looked for in the rendered page (built-in browser, signed in through `/sign-in` as that user, `/seat/professional/{id}/profile`, after it finished loading).

**Result.**

| Seat (user) | Home layout | API vs SQL mismatches | Preview = Home | Distinct page strings expected | Found | "Not found anywhere yet" rows (expected / seen) |
|---|---|---|---|---|---|---|
| 34 (user 7) | day 24 | 0 | yes | 35 | 35 | 6 / 6 (no bio, mobile, photo, service areas, designations or education) |
| 10 (user 34) | day 7 | 0 | yes | 40 | 40 | 3 / 3 |
| 20 (user 12) | day 1 | 0 | yes | 40 | 40 | 4 / 4 |

**115 of 115 page strings found; 0 API-vs-SQL mismatches on 3 seats; the missing-row counts match on all 3.** The preview's rating, review count, strength and city equal Home's on all 3.

None of the prototype's figures (`Alex`, `Demo Mortgage`, `Davenport, IA`, `482913`, `(563) 555-0100`, `(128)`, `67 facts`, `9 loan products`, the LinkedIn offer, `Quad Cities`) appeared on any real page, and the page showed no "Reset demo" button. Every seat shows an initials avatar (no photo is seeded), and the only image on the page is the shell's own icon.

**Seat 34 is the all-states seat:** no bio (the row reads `Bio Missing Not found anywhere yet Review draft`, offering NORA's draft), no mobile phone, no photo, no service areas, and no designations or education. Seat 10 has a full bio (so no draft row and the stored source line shows); seat 20 has a full bio, a mobile and no credentials at all (`Credentials Missing`).

**The page made one Profile read and no write.** The network log for seat 20 shows `GET /api/srp/seat/professional/20/profile` once; the other calls are the seat layout's existing reads (`GET .../professional/20`, `.../home`, `.../listings`, the `exp_office_mode` read rpc).

## Page strings per seat (what the page had to show)

### Seat 34, day 24 (6 missing rows)

| # | Expected on the page (from SQL) |
|---|---|
| 1 | Harper Jones |
| 2 | From LinkedIn |
| 3 | Branch Manager |
| 4 | Confirmed by you · Jul 1 |
| 5 | 2008 |
| 6 | From LinkedIn |
| 7 | (309) 555-7320 |
| 8 | Confirmed by you · Jun 29 |
| 9 | mock.users.7@example.test |
| 10 | Confirmed by you · Aug 1 |
| 11 | 9652 Main St, Bettendorf, IA 52801 |
| 12 | Confirmed by you · Jul 1 |
| 13 | Mon–Sat 9:00–4:00 |
| 14 | From Google |
| 15 | 8015989 |
| 16 | Confirmed by you · Jun 29 |
| 17 | Iowa and Illinois |
| 18 | Confirmed by you · Oct 15 |
| 19 | Five-Star Lender 2025 |
| 20 | From LinkedIn |
| 21 | Harper Jones |
| 22 | Branch Manager · Example Home Loans |
| 23 | 4.1 (71) · Bettendorf · NMLS 8015989 |
| 24 | 94% |
| 25 | Reviews (71) |
| 26 | ★ 4.1 rating |
| 27 | Conventional |
| 28 | VA |
| 29 | Cash-out |
| 30 | HELOC |
| 31 | 4 loan products |
| 32 | 1 of 3 added |
| 33 | 61 facts from 6 sources |
| 34 | Identity 13 |
| 35 | Contact 7 |
| 36 | Licence 7 |
| 37 | Products 8 |
| 38 | Reviews 15 |
| 39 | Presence 11 |

### Seat 10, day 7 (3 missing rows)

| # | Expected on the page (from SQL) |
|---|---|
| 1 | Finley Singh |
| 2 | From LinkedIn |
| 3 | Mortgage Loan Originator |
| 4 | From LinkedIn |
| 5 | Helps Bettendorf-area families buy and refinance homes, with a focus on first-time buyers and FHA and VA loans. |
| 6 | From LinkedIn |
| 7 | 2009 |
| 8 | Confirmed by you · Jul 8 |
| 9 | (309) 555-6018 |
| 10 | From Google |
| 11 | (563) 555-0727 |
| 12 | Confirmed by you · Jul 8 |
| 13 | mock.users.34@example.test |
| 14 | Confirmed by you · Sep 10 |
| 15 | 1523 Main St, Bettendorf, IA 52801 |
| 16 | From Google |
| 17 | Mon–Fri 8:30–5:30 |
| 18 | From Google |
| 19 | 2000916 |
| 20 | From NMLS |
| 21 | Iowa |
| 22 | Confirmed by you · Oct 19 |
| 23 | Davenport, Bettendorf, Rock Island, Moline |
| 24 | From Google |
| 25 | B.S. Finance, Example State University |
| 26 | Added by you · Jul 27 |
| 27 | Finley Singh |
| 28 | Mortgage Loan Originator · Example Mortgage Group |
| 29 | 4.8 (117) · Bettendorf · NMLS 2000916 |
| 30 | 76% |
| 31 | Reviews (117) |
| 32 | ★ 4.8 rating |
| 33 | FHA |
| 34 | USDA |
| 35 | Jumbo |
| 36 | Rate-and-term |
| 37 | Pre-approval |
| 38 | 5 loan products |
| 39 | 1 of 3 added |
| 40 | 62 facts from 6 sources |
| 41 | Identity 12 |
| 42 | Contact 11 |
| 43 | Licence 8 |
| 44 | Products 13 |
| 45 | Reviews 10 |
| 46 | Presence 8 |

### Seat 20, day 1 (4 missing rows)

| # | Expected on the page (from SQL) |
|---|---|
| 1 | Reese Evans |
| 2 | From LinkedIn |
| 3 | Mortgage Loan Originator |
| 4 | Confirmed by you · Sep 29 |
| 5 | Helps Rock Island-area families buy and refinance homes, with a focus on first-time buyers and FHA and VA loans. |
| 6 | From LinkedIn |
| 7 | 2005 |
| 8 | From LinkedIn |
| 9 | (563) 555-3371 |
| 10 | From Google |
| 11 | (309) 555-6935 |
| 12 | Confirmed by you · Jul 22 |
| 13 | mock.users.12@example.test |
| 14 | Confirmed by you · Sep 22 |
| 15 | 1747 Main St, Rock Island, IL 52802 |
| 16 | Confirmed by you · Oct 6 |
| 17 | Mon–Fri 8:30–5:30 |
| 18 | Added by you · Oct 14 |
| 19 | 5489614 |
| 20 | Confirmed by you · Jul 7 |
| 21 | Iowa and Illinois |
| 22 | From NMLS |
| 23 | Davenport, Bettendorf, Rock Island, Moline |
| 24 | From Google |
| 25 | Reese Evans |
| 26 | Mortgage Loan Originator · Example Home Loans |
| 27 | 4.1 (83) · Rock Island · NMLS 5489614 |
| 28 | 69% |
| 29 | Reviews (83) |
| 30 | ★ 4.1 rating |
| 31 | Conventional |
| 32 | FHA |
| 33 | VA |
| 34 | Rate-and-term |
| 35 | Cash-out |
| 36 | 7 loan products |
| 37 | Missing |
| 38 | 48 facts from 6 sources |
| 39 | Identity 9 |
| 40 | Contact 6 |
| 41 | Licence 4 |
| 42 | Products 9 |
| 43 | Reviews 9 |
| 44 | Presence 11 |

## Negative controls

- **Page check:** 11 deliberately wrong strings (`Reese Evan`, `4.2 (83)`, `70%`, `8 loan products`, `49 facts from 6 sources`, `NMLS 5489615`, `Identity 10`, `Confirmed by you · Sep 30`, `(563) 555-3372`, `Alex Sample`, `Riverbend`) were looked for on seat 20's page: 10 were not there (caught). `Reese Evan` was found because it is a substring of `Reese Evans`: the known weakness of substring matching, covered here by the exact value checks in the API-vs-SQL comparison.
- **API check:** the expectation script rerun with two wrong formulas (no date on the source lines, and a credentials denominator of 4) reported 7 mismatches per seat (six source lines and the credentials) and listed them.

## Findings from the trace

1. **Substring matching** can hide a one-letter error in a name; the API-vs-SQL comparison compares exact values, so the two together are the check.
2. **The profile photo is missing for every seat** because the Home seed keeps `profile_photo` null (initials) and the Profile plan keeps it null too. The photo-present path (image, source line, tier colour) is covered by unit and render tests but not by seeded data or the browser.
3. **No offer is invented:** no seat shows "I found 2 certifications on LinkedIn"; the credentials note reads `Missing` or `1 of 3 added` from the data.
4. **Mock text pairs:** the stored bios are generic ("Helps Bettendorf-area families...") and the address, NMLS and companies are mock; only their consistency (market city, state, sources, dates) is checked, not their realism.

## Re-run after the seed fixes (second review findings 1, 2 and 6)

The independent review found that the seeded data contradicted rules the page applies: full bios naming loan types the seat's products list lacked (7 of 21), an NMLS without a licensed state (1 seat) or the reverse (2 seats), a products graph group with no products fact (4 seats), and "Approved by you" on a thin bio (6 seats). After the seed plan fixes the seed was re-run on `v3_local` (`--as-of 2026-10-27`, backup `~/Documents/exp-v3/seed_backup_profile_fix_20261027.jsonl`, mode 600): **inserted 1, updated 40, deleted 2** (`profile_facts` 564 to 563); second run 0, 0, 0. Home totals and the SRS gap rows are unchanged.

| Check | Result |
|---|---|
| Full bios that name a loan product | 0 (was 7 of 21 inconsistent with the products list) |
| NMLS without a licensed state / a state without NMLS | 0 / 0 (was 1 / 2) |
| Products and licence graph groups against the facts | 0 mismatches (was 4 products groups without a fact) |
| "Approved by you" on a thin bio | 0 (was 6) |
| Still true: `value` only for the ten own fields; bios 6 missing, 13 thin, 21 full; address city equals the Home market city | 0 violations; same counts; 0 mismatches |
| API vs independent SQL on seats 20, 10, 34 | 0 mismatches on all 3; preview equals Home |
| Page strings found (seat 20: 38, seat 10: 39, seat 34: 34 distinct) | 111 of 111; "Not found anywhere yet" rows 4, 3 and 6 as expected; no prototype figure on any page |

