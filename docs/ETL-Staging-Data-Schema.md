# ETL staging data schema (v1, 2026-10-09)

Status: **agreed plan, not yet implemented.** This document defines how a harvested profile is stored in staging and how the later stations read it. It is the reference for the site mapper (Station 3), the harvest (Station 5), Station 6 (node creator), Station 7 (enhancer / reconciler), Station 8 (gauntlet) and the publish step.

Goal: every value that has a fixed home on the public profile is stored in staging under a **fixed (static) name**, in a **fixed format**, so later stations copy it to its column without AI and without a per-category mapping helper.

---

## 1. Where staged data lives

Table `exp_etl_staging`, one row per harvested profile page.

| Column | Holds |
|---|---|
| `payload` (jsonb) | Taxonomy layer and extras (section 2) |
| `identity_candidates` (jsonb) | Static layer under `universal`, plus a short identity summary for matching |
| `gcid`, `entity_type`, `source_id`, `detail_url` | Row context (category, professional / location, source, page URL) |
| `resolution_status`, `entity_id`, `resolved_at`, `field_tier`, `rejected_reason` | Station 6 outcome |

No new table or column is needed for this schema.

Where the profile pages come from is part of the site contract, not of staging: `disco_site_contract.extraction.site_contract.list_route` (added 2026-10-13, plan G1) records how site mapper version 2 found and proved the site's list of profiles — `sources` (sitemap / listing / API, as version 2's config), `profile_url_pattern`, `estimate`, `coverage`, `harvestable` (true only when every source is a sitemap, the one route the harvest reads today; listing and API routes wait for G3) and `detail_pattern_from` (`v1` or `v2`). Version 2's sitemaps are also written to `disco_site_contract.profile_sitemaps`, which Run seeds from.

## 2. The three layers

| Layer | Location | What goes in | Who reads it |
|---|---|---|---|
| **Static** | `identity_candidates.universal` | The fixed list in section 3. Same key names for every category and every site. Formatted per section 4. | Station 6 → `exp_entity.attributes`; publish → public columns and graph nodes |
| **Taxonomy** | `payload.<node_slug>` with `payload._subjects.<node_slug>` = `person` / `branch` / `firm` | The category's registry keys (`exp_vertical_node_registry.node_slug`). Unchanged by this schema. | Rings, scoring, Station 7 term matching, Station 8 |
| **Extra** | `payload._extra.<name>` | True leftovers only: found on the page, with no static key and no taxonomy key. Names are listed in `exp_field_discovery`. | Review; future promotion to static or taxonomy |

Rules:
- A value that has a static key **must** be written to the static layer. It may also stay under its taxonomy key (one value can live in both).
- A value that has a static key must **not** stay only in `_extra`.
- Metadata stays as today: `payload._contract {version, learned_at}`, `payload._subjects`, `payload._firm_ref`.

### Record layout

```json
{
  "payload": {
    "advisor_name": "Trae Farrell, CFP®",
    "advisor_biography": "…",
    "_subjects": { "advisor_name": "person", "advisor_biography": "person" },
    "_extra": { "personal_interests": ["Golf", "Travel"] },
    "_contract": { "version": 3, "learned_at": "2026-09-28T11:05:15Z" },
    "_firm_ref": { "learned_at": "2026-09-28T11:05:15Z" }
  },
  "identity_candidates": {
    "url": "https://advisor.morganstanley.com/trae.farrell",
    "name": "Trae Farrell", "phone": "+14803454738", "email": null,
    "street": "14850 N Scottsdale Rd", "city": "Scottsdale", "state": "AZ", "postal_code": "85254",
    "branch_name": null, "firm_name": "Morgan Stanley",
    "universal": {
      "person.name": "Trae Farrell",
      "person.job_title": "Associate Vice President, Wealth Management",
      "person.bio": "…",
      "person.photo_url": "https://…/613x613.jpg",
      "person.phone": "+14803454738",
      "person.credentials": [
        { "name": "CFP®", "type": "designation", "number": null, "issuer": "CFP Board", "state": null },
        { "name": "NMLS", "type": "registration", "number": "2235690", "issuer": "NMLS", "state": null }
      ],
      "person.services": ["Wealth Management", "Estate Planning Strategies"],
      "location.street": "14850 N Scottsdale Rd Suite 600",
      "location.city": "Scottsdale", "location.state": "AZ", "location.postal_code": "85254",
      "location.latitude": 33.6222, "location.longitude": -111.9264,
      "location.phone": "+14803454738",
      "firm.firm_name": "Morgan Stanley",
      "firm.website": "https://www.morganstanley.com/",
      "firm.social_links": [ { "platform": "linkedin", "url": "https://www.linkedin.com/company/morgan-stanley" } ]
    }
  }
}
```

Static keys are **flat strings with a dot** (`"person.bio"`), not nested objects. Empty values are omitted, not stored as `null` or `""`.

---

## 3. Static field list

Columns: **Key** · **Type** (section 4) · **Meaning** · **Station 6** (`exp_entity.attributes` key) · **Publish** (public column) · **Graph node** (`graph_nodes.node_type {extracted_data keys}`).

Station 6 stores each static value in `exp_entity.attributes` under the part after the dot (`person.bio` → `attributes.bio`) on the matching entity: `person.*` → the professional, `location.*` → the office, `firm.*` → the brand. The name keys also set the entity's `display_name`.

### 3a. Person (professional)

| Key | Type | Meaning | Station 6 | Publish column | Graph node |
|---|---|---|---|---|---|
| `person.name` | text | Full name only; post-nominals (CFP®, CEPA, MSFP) removed and moved to `person.credentials` | entity `display_name`; `name` | `professionals.display_name`; `first_name` / `last_name` split by rule; `search_documents.name` | `identity_name {value}` |
| `person.first_name` | text | Only when the page shows it separately | `first_name` | `professionals.first_name` | — |
| `person.last_name` | text | Only when the page shows it separately | `last_name` | `professionals.last_name` | — |
| `person.job_title` | text | One main title (the first one shown) | `job_title` | `professionals.job_title`; `search_documents.title` | — |
| `person.headline` | text | Tagline, when the page has one | `headline` | `professionals.headline` (else built at publish) | — |
| `person.bio` | text | The person's own description | `bio` | `professionals.bio`; `short_bio` = first sentence, max 160 chars | `bio {value}` |
| `person.photo_url` | url | Headshot | `photo_url` | `professionals.photo_url`; `search_documents.photo_url` | `image_photo {url}` |
| `person.cover_photo_url` | url | Banner image | `cover_photo_url` | `professionals.cover_photo_url` | `image_cover {url}` |
| `person.phone` | phone | The person's line as shown on their page | `phone` | `professionals.phone` | `contact_phone {value}` |
| `person.fax` | phone | Personal fax (rare; office fax goes to `location.fax`) | `fax` | — | `contact_fax {value}` |
| `person.email` | email | Personal email | `email` | `professionals.email` | `contact_email {value}` |
| `person.website` | url | The person's own site (not the firm home page, not the profile page). Staging holds only a site shown on the page; at Station 6 a `brand_site` source uses the profile page when no own site is shown (see "Person website by source type") | `website` | `professionals.website_url` | `website {value}` |
| `person.profile_url` | url | The harvested profile page | `profile_url`; identity key | `professionals.detail_url`, `canonical_url` | — |
| `person.street` | text | Street line incl. suite | `street` | — (no column; page uses the office street) | `address {street, city, state, postal_code}` |
| `person.city` | text | City | `city` | `professionals.address_city` | (in `address`) |
| `person.state` | state | 2-letter code | `state` | `professionals.address_state` | (in `address`) |
| `person.postal_code` | postal | ZIP | `postal_code` | `professionals.address_zip` | (in `address`) |
| `person.languages` | list | Languages spoken | `languages` (list) | `professionals.languages`; `search_documents.languages` (via `exp_facet_lang_tick`) | `language {language}`, one per item |
| `person.license_number` | text | Main licence number | `license_number` | `professionals.primary_license_number` | (also a `credential` node) |
| `person.license_type` | text | Main licence type | `license_type` | `professionals.primary_license_type` | — |
| `person.license_state` | state | Main licence state | `license_state` | `professionals.primary_license_state` | — |
| `person.credentials` | list of `credential` | Designations, licences, registrations | `credentials` | `credentials` rows: `name`, `credential_type`, `identifier`, `issuing_org`, `issuing_state` | `credential {type, number, issuer, state}` |
| `person.services` | list | Services / products / focus areas, as the site words them | `services` | — | `product_service {name}` (Services / coverage products section) |
| `person.specialties` | list | Specialisations / audiences, when the site separates them from services | `specialties` | — | `specialty` (title) |
| `person.service_areas` | list | Places served | `service_areas` | `professionals.markets_served` | `service_area` (title) |
| `person.social_links` | list of `link` | Personal social profiles | `social_links` | `professionals.same_as` (urls) | `social_profile {platform, url}` |
| `person.year_started` | year | Start year (from "N years of experience" when that is what the page shows) | `year_started` | — | `profile_attributes {year_started}` |
| `person.booking_url` | url | Appointment / contact link for this person (when the page gives none: the first `book` action) | `booking_url` | — | `profile_attributes {cta_url}` |
| `person.team` | list of `member` | Team members shown on the page | `team` | — | `team_member {name, role, license, photo_url}` |
| `person.education` | list of `education` | Degrees / schools | `education` | — (no public slot yet) | — |
| `person.awards` | list of `award` | Awards / recognitions | `awards` | — (no public slot yet) | — |
| `person.work_history` | list | Jobs the person has held, as the page lists them (title, employer, years) — added 2026-10-12 | `work_history` | — (graph nodes only) | `work_history` |
| `person.disclaimer` | text | Compliance / disclosure line | `disclaimer` | — | `profile_attributes {disclaimer}` |
| `person.actions` | list of `action` | Every call to action for this person as shown (Get a quote, Book, Schedule, Contact, Call, Text, Book a demo …); site-wide navigation and account links excluded | `actions` | — (no public slot yet) | — |
| `person.videos` | list of `video` | Videos of / by the person embedded or linked on the profile (YouTube, Vimeo, Wistia, Vidyard, Loom, video files); videos on most pages of the site excluded | `videos` | — (no public slot yet; `media_items` is not filled by the ETL) | — |
| `person.gallery` | list of url | The person's gallery images (not the headshot, cover or logos; images on most pages of the site excluded) | `gallery` | — (no public slot yet) | — |
| `person.gbp_place_id` | place_id | The person's own Google Business Profile place id, when the page links to it (real estate agents, loan officers, solo agents); an office profile goes to `location.gbp_place_id` | `gbp_place_id` | `professionals.gbp_place_id` | `gbp_place {value}` |

### 3b. Office (location)

| Key | Type | Meaning | Station 6 | Publish column | Graph node |
|---|---|---|---|---|---|
| `location.business_name` | text | Office / branch name | entity `display_name`; `business_name` | `organizations.name` (required); slug from it | — |
| `location.street` | text | Street line incl. suite | `street` | `organizations.address_street` | `address {…}` |
| `location.city` | text | City | `city` | `organizations.address_city` | (in `address`) |
| `location.state` | state | 2-letter code | `state` | `organizations.address_state` | (in `address`) |
| `location.postal_code` | postal | ZIP | `postal_code` | `organizations.address_zip` | (in `address`) |
| `location.latitude` | number | Decimal degrees | `latitude` | `organizations.latitude` | `geo {latitude, longitude}` |
| `location.longitude` | number | Decimal degrees | `longitude` | `organizations.longitude` | (in `geo`) |
| `location.phone` | phone | Office main line | `phone` | `organizations.phone` | `contact_phone {value}` |
| `location.fax` | phone | Office fax | `fax` | — | `contact_fax {value}` |
| `location.email` | email | Office email | `email` | `organizations.email` | `contact_email {value}` |
| `location.website` | url | Office page (never the person's profile page) | `website` | `organizations.website_url` | `website {value}` |
| `location.description` | text | Office description | `description` | `organizations.description` | `bio {value}` |
| `location.logo_url` | url | Office logo | `logo_url` | `organizations.logo_url` | `image_logo {url}` |
| `location.photo_url` | url | Office photo | `photo_url` | `organizations.cover_photo_url` | `image_cover {url}` |
| `location.hours` | list of `hours` | Opening hours per day | `hours` | — | `hours {day, opens, closes}` per day; text that cannot be split → `office_hours {hours[]}` |
| `location.timezone` | text | IANA name or abbreviation as shown | `timezone` | — | `office_hours {tz}` |
| `location.social_links` | list of `link` | Office social profiles | `social_links` | `organizations.same_as` (urls) | `social_profile {platform, url}` |
| `location.actions` | list of `action` | Every call to action for this office, same rules as `person.actions` | `actions` | — (no public slot yet) | — |
| `location.videos` | list of `video` | Videos of / by the office, same rules as `person.videos` | `videos` | — (no public slot yet) | — |
| `location.gallery` | list of url | Office gallery images (office, team, events), same rules as `person.gallery` | `gallery` | — (no public slot yet) | — |
| `location.gbp_place_id` | place_id | Google place id when the page links to Maps | `gbp_place_id` | `organizations.gbp_place_id` | `gbp_place {value}` |

### 3c. Brand (firm)

| Key | Type | Meaning | Station 6 | Publish column | Graph node |
|---|---|---|---|---|---|
| `firm.firm_name` | text | Brand name | entity `display_name`; `firm_name` | `organizations.name` | — |
| `firm.legal_name` | text | Registered name | `legal_name` | `organizations.legal_name` | — |
| `firm.website` | url | Home page; its domain is the brand identity key | `website` | `organizations.website_url` | `website {value}` |
| `firm.logo_url` | url | Logo | `logo_url` | `organizations.logo_url` | `image_logo {url}` |
| `firm.phone_main` | phone | Head-office line | `phone_main` | `organizations.phone` | `contact_phone {value}` |
| `firm.fax` | phone | Head-office fax | `fax` | — | `contact_fax {value}` |
| `firm.email` | email | Head-office email | `email` | `organizations.email` | `contact_email {value}` |
| `firm.street` | text | Head-office street | `street` | `organizations.address_street` | `address {…}` |
| `firm.city` | text | | `city` | `organizations.address_city` | (in `address`) |
| `firm.state` | state | | `state` | `organizations.address_state` | (in `address`) |
| `firm.postal_code` | postal | | `postal_code` | `organizations.address_zip` | (in `address`) |
| `firm.description` | text | Brand description | `description` | `organizations.description` | `bio {value}` |
| `firm.social_links` | list of `link` | Brand social profiles (incl. the brand YouTube channel) | `social_links` | `organizations.same_as` (urls) | `social_profile {platform, url}` |

### 3d. Helper keys (used inside the mapper, never written to staging)

`person.address_block`, `location.address_block`, `firm.address_block` (split into street / city / state / postal code at harvest), `person.branch_name`, `person.registration_ids`, `person.licenses` (folded into `person.credentials`), `person.years_experience` (converted to `person.year_started`).

---

## 4. Formats

| Type | Rule | Example |
|---|---|---|
| text | Plain text, no HTML, whitespace collapsed, trimmed | `Senior Vice President` |
| phone | US only: 10 digits, no `+1`, no labels, one number per key (changed 2026-10-13; earlier rows used E.164 `+1…`). Valid North American numbers only: area code and exchange start with 2-9; all-one-digit, 1234567890 and 555-01xx are dropped. `+1` is added only for click-to-call links and schema.org. | `4803454738` |
| email | Lower case, one address | `jane.doe@example.com` |
| url | Absolute `https://`; tracking parameters removed | `https://www.example.com/jane` |
| state | 2-letter US code | `AZ` |
| postal | 5 digits or 5-4 | `85254`, `49428-8430` |
| year | Integer | `2004` |
| number | JSON number | `33.6222` |
| place_id | Google place id as given by the page: the value itself or the `place_id` / `query_place_id` parameter of a Maps link; links without one (`cid=`, short links) are not converted | `ChIJN1t_tDeuEmsRUsoyG83frY4` |
| list | JSON array of trimmed strings, no duplicates (case-insensitive). Entries in separate page elements (e.g. separate `<li>`) are separate entries; line breaks, `;` and ` | ` inside one element split. Commas split only where the mapper decided so for that site and field from the sample pages (rule `split_commas`): "Life & Health, Property & Casualty" → two entries, "Series 7, 63, 65" → one entry kept as shown. | `["Annuities", "529 Plans"]` |

### Object shapes (fixed sub-keys; missing values omitted)

| Name | Shape | Notes |
|---|---|---|
| `credential` | `{name, type, number, issuer, state}` | `type` ∈ `designation` / `license` / `registration`. Labels are stripped from `number` (`"NMLS#: 1285385"` → `"1285385"`). |
| `link` | `{platform, url}` | `platform` from the URL domain: `facebook`, `linkedin`, `x`, `instagram`, `youtube`, `tiktok`, `pinterest`, `yelp`, `google`, `other`. |
| `hours` | `{day, opens, closes}` | `day` = `Monday` … `Sunday`; times `HH:MM` 24-hour; a closed day has no `opens` / `closes`. |
| `member` | `{name, role, license, photo_url}` | |
| `video` | `{url, platform, title}` | `url` canonical per platform (`https://www.youtube.com/watch?v=<id>`, `https://vimeo.com/<id>`, …; video files keep their URL); `platform` ∈ `youtube`, `vimeo`, `wistia`, `vidyard`, `loom`, `file`; `title` from the player / link when shown. Read by the page rule, and on new mappings also from players embedded in the page's main content (never header / footer). |
| `award` | `{title, year, issuer, description, url}` | From the page's own parts when each award is a block (title, year, issuer, description, link); plain text → `title`, plus `year` when exactly one year is shown ("Five Star Wealth Manager, 2022" → title + 2022). |
| `education` | `{school, degree, year, text}` | From the page's own parts when structured; plain text stays in `text` (school / degree are not guessed), plus `year` when exactly one year is shown. |
| `action` | `{label, url, type}` | `label` = button / link text as shown; `url` = absolute https, or `tel:` / `mailto:` / `sms:`; `type` by fixed rules on the text and link: `quote`, `demo`, `book`, `review`, `text`, `call`, `email`, `contact`, `other`. Filled from the page buttons and from every category action key (schema.org `potentialAction`) of the same subject, merged; an action with the same text and link on most sample pages of a site is navigation and is dropped; a call / text / email action for a phone number or email already captured in a static key of the record is dropped. |

---

## 5. How static values are filled (in this order, first non-empty wins)

For **list** keys (services, specialties, awards, education, languages, service areas, credentials, social links, hours, team) every source below is merged instead (page rule + all matching taxonomy keys + all routed extras, duplicates removed); for example a site's "Products" and "Services" sections both feed `person.services`. The "first non-empty wins" order applies to single-value keys.

1. **Page rule** — the site contract has a locator for the static key (learned once at Station 3, applied by code at harvest).
2. **From a taxonomy key on the same record** — when exactly one taxonomy key on the record has the same subject (`payload._subjects`) and the same `schema_property` as the static key, its value is copied (for example `profile_photo` (person, `image`) → `person.photo_url`; `geo_coordinates` (branch, `geo`) → `location.latitude` / `location.longitude`). When two or more taxonomy keys qualify with different values, nothing is copied.
3. **From an extra by a contract route** — the site contract lists which extra name feeds which static key (for example `focus_areas` → `person.services`). The route is stored in the contract when the site is mapped and applied by code; no AI at harvest.
4. **Derived by rule** — `person.year_started` from "N years of experience" (a page value for years of experience counts only if it is 1–79 years; anything else, e.g. a 4-digit year, is discarded first); licence fields from a licence sentence; post-nominals split off the name into `person.credentials`; address parts from an address block.
   - *Years of experience (2026-10-12):* "N years of (professional / industry) experience" in the person's own bio text gives `person.year_started`, also when that text is later dropped as a bio (job-history list); site-wide (boilerplate) text never counts.
   - *Office block (2026-10-12):* an extra that is one text with an office address and one phone at the end ("[branch name] 11 Main Street City ST 12345 555-555-5555") fills the empty `location.street` / `city` / `state` / `postal_code`, and becomes `location.phone` when the page gave no office phone or only the person's own number. Single texts only (never lists); it must agree with the office address parts already on the page; the extra is then removed.

### Quality rules (applied before writing)

- **Boilerplate / generic text**: a bio must be about the person — it names them, speaks as or about a person (I / my / we; he / she / they in 2+ sentences) or is a substantial text (200+ characters, 2+ sentences); text identical on most of a site's sample pages, generic site text and job-history lists (2+ year ranges) are not a bio and are skipped (not moved to another key). Whether a bio is required to publish is set per gcid in `exp_etl_field_floors` (owner decision 2026-10-10: not mandatory by default); generic text is never shown as a bio.
- **Wrong content**: a value whose shape does not fit the key is dropped (for example a bio that is a job-history list; a booking URL that is the firm home page; social links that are address text).
- **US formats**: `person.profile_url` is always the harvested page; US coordinates are latitude north (+) and longitude west (−), dropped when outside the US range; a licence type longer than a label (60+ characters or a list) is replaced by the first licence's name; the firm website and the office website are never the profile page; social links never point back to the site itself.
- **Same meaning, two subjects**: when `person.phone` equals `location.phone`, both are kept; Station 7 decides which public column shows it.
- **Person website by source type** (owner rule 2026-10-12, applied at Station 6, not in staging): for a `brand_site` source, `person.website` is the person's own site when the page shows one, otherwise their profile page on the brand site (recorded as `_sources["person.website"] = "derived_from_profile_url"`). For `portal`, `directory`, `license_registry`, `association`, `review_platform`, `social` and `other` sources, `person.website` is only a site the page shows — never the profile page. Across sources, a site shown on a page beats a derived profile page; between derived values the source with the better `authority_rank` wins.

---

## 6. How each station consumes the schema

| Station | Reads | Does |
|---|---|---|
| 4 — Field-yield gate | Static + taxonomy values | `countDistinctFields` counts each distinct value once. The measured `field_floor` is re-measured at the next remap of each source. |
| 6 — Node creator (`exp_etl_resolve`) | `identity_candidates.universal` only | Creates / matches brand, office and professional; copies every static value to `exp_entity.attributes` of the matching entity (key = part after the dot). |
| 7 — Enhancer / reconciler | `exp_entity.attributes`, `payload` taxonomy keys | Office reconcile (shared-office phone conflicts), de-duplication, optional term matching of `services` / `specialties` to `exp_taxonomy` (proposals only, never auto-adds). |
| 8 — Gauntlet | `exp_entity.attributes`, `exp_rel` | Validators read fixed attribute names, e.g. `PRO_HAS_BIO` checks `attributes ? 'bio'`. |
| Publish | `exp_entity.attributes`, `exp_rel` | Fixed copy to the columns and graph node types in section 3. No AI. |
| Search | `exp_entity.attributes.languages` | `exp_facet_lang_tick` fills `search_documents.languages`. |

### Filled at publish without a staging key

`slug`, `display_name`, `first_name` / `last_name` split, `headline` fallback (job title + firm + city), `short_bio`, `address_country` (default `US`), `canonical_url`, `is_active`, `gcid` (from `exp_etl_staging.gcid`), `primary_org_id` (works-at link), `parent_org_id` (operates-under link), `schema_type` (`exp_category_page_template` / `exp_category_profile_config`), `search_documents` rows, `graph_nodes.ring_key` / `ring_layer` (trigger `trg_graph_nodes_ring_autofill`).

Not from the ETL: `reviews`, `aggregate_ratings`, `media_items`, `content_items`, `graph_edges`, rank scores, claim fields.

---

## 7. Change to the earlier person-identity rule (S4-0)

S4-0 (2026-09-28) limited the person static fields to identity (name, job title, phone, email, street, city, state, postal code, profile URL). Under this schema **every key in section 3a is a static field written to staging**. Only the helper keys in 3d stay internal.

---

## 8. Current financial advisor data against this schema (live, 2026-10-09)

Rows: Edward Jones 11,732 · Morgan Stanley 6,169 · Schwab 2,780 (11,857 pending).

| Static key | Edward Jones | Morgan Stanley | Schwab |
|---|---|---|---|
| `person.name` | static | static; 2,768 with post-nominals | static; 1,480 with post-nominals |
| `person.job_title` | not captured | static (first title) | static |
| `person.bio` | not captured | taxonomy `advisor_biography` (tagline; one sentence on 1,946 rows) | taxonomy `advisor_biography` (2,772 are job history) |
| `person.photo_url` | taxonomy `profile_photo` 11,701 | taxonomy `profile_photo` 5,509 | not captured |
| `person.phone` | static, `(999) 999-9999` | static, `+1-999-999-9999` | static, `+1 999-999-9999` |
| `person.credentials` | extra `designations` 7,639 (comma string) + taxonomy `cfp_*` | extra `designations` 2,705, `nmls_number` / `insurance_license_number` 6,146 (one sentence) + post-nominals | extra `insurance_license_number_2` 2,770 (designation names) + taxonomy `cfp_*` + post-nominals |
| `person.services` | extra `focus_areas` 9,964 | extra `focus_areas` 3,764 | not captured |
| `person.team` | extra `employment_history_2` 10,697 (team member names) | — | — |
| `person.education` | — | — | extra `education` 2,616 |
| `person.disclaimer` | — | extra `crc_disclosure_number` 6,169 | — |
| `person.booking_url` | taxonomy `contact_action` 11,701 | taxonomy `appointment_booking_url` 922 | taxonomy `appointment_booking_url` = home page (drop) |
| `person.year_started` | — | — | derive from `advisor_biography` / extra `employment_history` |
| `location.*` address | static; 1,385 streets with the suite glued on ("PkwySuite 106") | static (correct); the taxonomy address object has `streetAddress` = suite only | static on 2,428; street on 1,058 |
| `location.latitude` / `longitude` | — | taxonomy `geo_coordinates` 6,169 | — |
| `location.hours` | static text 10,497 + taxonomy `operating_hours` 10,792 | — | — |
| `location.description` | static, wrong content (office panel text) — drop | — | — |
| `location.social_links` | static, wrong content (address text) — drop | — | — |
| `firm.social_links` | static, plain URLs (convert to `link`); add taxonomy `youtube_channel` (brand channel) | same | same |

Extras that stay extras for financial advisors: `personal_interests`, `new_client_waitlist_status`, `employment_history` (Schwab), `employment_history_2` (Morgan Stanley; mixed process / service text).

Taxonomy keys that always repeat the same value (registry overlap; no action under this schema): `advisor_name` = `advisor_full_name`; `primary_office_address` = `primary_service_address`; `advisor_job_title` = `job_title_display`; `cfp_designation` = `cfp_certification` = `cfp_board_standards_compliance`; `contact_action` = `contact_form_submission`.

---

## 9. Implementation steps

Each step is a separate change with its own approval and its own entry in `docs/ETL-Enhancements.md`.

1. **Key lists (code)** — `-disco-site-contract.ts`: `PERSON_KEYS`, `LOCATION_KEYS`, `FIRM_KEYS` hold exactly the keys and types of sections 3a–3c (add `object` handling for `credential`, `link`, `hours`, `member`); `PERSON_IDENTITY_KEYS` / `isIdentityId` cover every section-3 key; helper keys per 3d. Applies to both site mapper versions: whichever mapper writes the contract must provide locators for static keys.
2. **Contract routes (code)** — the contract stores (a) taxonomy-to-static copies that pass the one-to-one rule of section 5 step 2 and (b) extra-to-static routes (section 5 step 3), decided once at mapping time.
3. **Harvest writer (code)** — `buildHarvestRecord` writes all static keys into `identity_candidates.universal` in section-4 formats, applies section 5 order and quality rules, and removes routed extras from `_extra`.
4. **Station 6 (database function)** — `exp_etl_resolve` copies all static keys to `exp_entity.attributes` per entity.
5. **Existing rows (data)** — backfill `identity_candidates.universal` of existing financial advisor rows from their own `payload` (section 8 mapping), tested first in a rolled-back run; fields not in the payload (Edward Jones bio and job title, languages) need a re-harvest.
6. **Publish (new database function)** — fixed copy from `exp_entity.attributes` to the section-3 columns and graph nodes.

### Acceptance checks (per source, after steps 1–3 and a remap)

- Every pending row has `person.name`, `person.profile_url` and at least one of `person.phone` / `location.phone` in `universal`.
- No `universal` phone fails E.164; no `person.name` contains `®`, `™` or a trailing comma part.
- Values of `person.bio` are not shared by more than a small share of the source's rows.
- Every extra name routed in the contract is absent from `_extra`.
- `field_floor` re-measured; the Station 4 gate passes on the sample.

## 10. Open

- Whether `person.specialties` is filled for financial advisors (their professional page template shows services, not specialties).
- Public slots for `person.education` and `person.awards`.
- `new_client_waitlist_status` as a possible static key (accepting new clients).
- Term matching threshold for `services` / `specialties` at Station 7 (current overlap with the financial advisor term list is low: 1 of 52 Edward Jones and 22 of 557 Morgan Stanley distinct items at similarity ≥ 0.6).
