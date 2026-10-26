# NORA OS — Skills Registry & Capability Model

**Status:** v0.2 (draft for the dev fleet) · **Owner:** NORA OS
**Purpose:** The authoritative contract for how NORA does everything. This document defines (1) the difference between *tools* and *skills* and where each lives, (2) the access-state machine every skill must branch on, (3) the skill contract schema, (4) the tool catalog (primitives), and (5) the full skills registry — every skill, tailored, with its state-dependent behavior.

The acceptance test for NORA OS is simple: **if the kernel can run the first-run interview end-to-end, through the registry, on real data, across all three access groups, the OS is built.** The interview is a strict subset of the perpetual agent loop, so passing it means ~90% of NORA's capability surface exists.

---

## 1. Tools vs. Skills — and where each lives

These are two different layers. Conflating them is the single most common way an agent platform rots.

### Tool
A **tool** is a single deterministic primitive: one input→output function with a side effect, no judgment, no goal awareness, no notion of *who* the user is. It does one thing the same way every time.

- Examples: `serp.fetch(query, geo)`, `geocode(address)`, `graph.upsertNode(node)`, `maprank.query(entity, keyword, geo)`, `sms.send(to, body)`, `score.run(entity)`.
- **Lives in:** the engine / infrastructure layer — ETL services, the graph DB functions, the search/index service, external-API adapters, the comms service. Owned by the surface/infra teams (the fleet) and platform infra.
- **Not governed:** tools carry no consent, no compliance class, no price. They are dumb hands.
- **Reusable** across many skills and many surfaces.

### Skill
A **skill** is a governed, composable unit of *NORA's behavior*. It orchestrates one or more tools (and sometimes other skills) to achieve an outcome, and it carries everything a tool doesn't: awareness of the world-model, the user's access state, provenance rules, consent requirements, compliance class, commercial class, metering, and degradation behavior.

- Examples: `discover-presence`, `claim.verify`, `plan.generate`.
- **Lives in:** the NORA OS layer, registered here. Owned by the NORA OS team.
- **Governed:** consent, compliance, and monetization attach at the **skill** level, never the tool level.
- **NORA-specific:** skills encode judgment and policy; they are not generic.

### The mental model
> Tools are syscalls. Skills are the programs the OS schedules.
> Tools are verbs the hands can perform. Skills are jobs NORA *decides* to do — with state-awareness, permission, and a price.

### Layering

```
┌─────────────────────────────────────────────────────────┐
│  NORA OS                                                  │
│   • Kernel (observe→decide→act→measure, scripted|auto)   │
│   • Planner / Goal engine (#1 and hold)                  │
│   • SKILLS REGISTRY  ◄── this document                   │
│   • Governance envelope (consent, compliance, audit)     │
│   • Monetization bridge (commercial class → paywall)     │
│   • World-model (graph, snapshot, ledger, policy, goal)  │
└───────────────▲──────────────────────────────────────────┘
                │  skills call tools across this contract line
┌───────────────┴──────────────────────────────────────────┐
│  ENGINE / INFRA (TOOLS)                                   │
│   ETL · Graph DB · Search/Index · Scoring · MapRank      │
│   provider · LLM-citation provider · Comms · Billing     │
└──────────────────────────────────────────────────────────┘
```

**The registry is the contract boundary between the two layers.** The fleet builds tools behind stable tool signatures; NORA OS builds skills that compose them. Both can proceed in parallel and integrate because the seam is defined here.

---

## 2. The Access-State Machine

Every skill behaves differently depending on **who the user is / what data exists** (the access group) and **where they are in the journey** (the stage). The kernel resolves state before invoking any skill and passes it in; each skill declares its per-state behavior below.

### 2.1 Access groups (entry path + data condition)

| Code | Name | How they arrive | Data condition | Identity basis |
|------|------|-----------------|----------------|----------------|
| **G-COLD** | Create-New / Unindexed | Searched, no profile found, clicked **Create new** | **No ETL. No inferred graph.** | Unverified — must be established |
| **G-CLAIM** | Claim-Indexed / New-to-Experience | Found their pre-built profile, clicked **Claim**; never an Experience.com user | **ETL done. Rich inferred graph exists.** | Established by claim + verification |
| **G-RETURN** | Returning Experience.com User | Logs into an existing Experience.com account; discovers the new experience | **Graph + account history + entitlements + possibly prior owned data** | Already established by auth |

> **The G-COLD rule (critical):** because no ETL has run, nearly every downstream skill flips from *confirm/augment* mode into *cold-build* mode. Before anything is inserted, a **secondary lookup** (`claim.create_new`) must run to make sure the user isn't already in the index under a variant — otherwise G-COLD manufactures duplicate entities and corrupts the graph at scale. If the secondary lookup *finds* them, the user is silently promoted to **G-CLAIM**.

### 2.2 Journey stages (per group)

| Code | Stage | Meaning |
|------|-------|---------|
| **J0** | Pre-claim | Considering; identity not yet established (G-COLD/G-CLAIM only) |
| **J1** | Identity established | Claimed, or created-new, or authenticated |
| **J2** | Interview in progress | The skill sequence is running (resumable) |
| **J3** | Interview complete | Graph organized, plan built, work agreement set |
| **J4** | Active / perpetual | NORA runs the standing goal loop |

### 2.3 Entry points & progression

- **G-COLD** enters at J0 → `claim.create_new` (with secondary lookup) → J1 → interview (J2) → J3 → J4.
- **G-CLAIM** enters at J0 (viewing their unclaimed profile) → `claim.verify` → J1 → interview (J2) → J3 → J4.
- **G-RETURN** skips J0/J1 claim (auth *is* identity) → enters interview at J2 (or, if already interviewed, resumes at J3/J4).

**Progression rule:** completing a stage's required skills advances the user to the next stage for their group. A user who abandons mid-interview (J2) is resumable: the kernel re-enters at the first incomplete step. A returning user who already completed the interview re-enters at J4 and sees the perpetual experience, not the interview.

### 2.4 How state changes a skill (the pattern)

Most skills implement one of three postures depending on group:

- **CONFIRM** (G-CLAIM, G-RETURN at J2): inferred data exists → present it, let the owner verify, upgrade provenance.
- **COLD-BUILD** (G-COLD): no data → trigger acquisition (ETL/discovery) first, then build, with a secondary dedupe gate before insert.
- **RECONCILE** (G-RETURN): owned/account data already exists → merge with graph, respect prior entitlements and owner-verified facts, don't re-ask what's already known.

Each skill entry below specifies its posture per group.

---

## 3. Skill Contract Schema

Every registry entry uses this base schema. **Fields are omitted when N/A and extended when a skill needs more** — skills are not uniform.

- **id** — stable name
- **summary** — one line
- **tools** — primitives it composes (the tools/skills seam)
- **reads / writes** — world-model objects
- **inputs → outputs**
- **preconditions** — what must be true to run
- **behavior by group** — G-COLD / G-CLAIM / G-RETURN (+ stage notes)
- **provenance** — what provenance state it sets
- **consent / compliance class** — `safe-autonomous` | `consent-gated` | `human-review-required` | `restricted(vertical)`
- **commercial class** — `free` | `metered` | `paid-unlock`
- **run mode** — `scripted` (interview) | `autonomous` (loop) | `on-demand` (chat) — most are several
- **degradation** — behavior on tool failure / missing data
- **emits** — events, ledger items, attribution telemetry
- **human touchpoint** — what the user sees/does
- **notes / open** — decisions still owed

### Cross-cutting enums

**Provenance states** (stamped on every node/signal): `inferred` · `owner_verified` · `owner_rejected` · `system_derived`. **Precedence for conflict resolution:** `owner_verified` > `first_party_source` > `open_web_confirmed` > `inferred`.

**Source hop** (how far from the anchor the fact came): `0 anchor` · `1 first_party` · `2 hop2` · `3 open_web`.

**Compliance classes:** `safe-autonomous` (NORA may do it unattended), `consent-gated` (needs the owner's standing or per-action OK), `human-review-required` (owner must approve the specific output), `restricted(vertical)` (licensed-industry rules apply — e.g., advertising claims for a loan officer).

**Commercial classes:** `free` (always), `metered` (usage-billed), `paid-unlock` (behind a tier — the Ledger surfaces it as the pitch).

---

## 4. Tool Catalog (primitives — the engine layer)

These are *tools*, not skills. They live in infra, are owned by the fleet, and carry no governance. Listed so the seam is explicit; skills reference them by name.

**Acquisition**
- `serp.fetch(query, geo)` → ranked results
- `page.fetch(url)` / `crawl.site(url, depth)` → raw HTML
- `html.parse` / `jsonld.parse` → structured fields
- `nlp.extract(text, schema)` → typed fields (name/title/about/products)
- `geocode(address)` → lat/lng + normalized address
- `vision.ingest(image)` / `ocr(image)` → media node + text

**Graph**
- `graph.query(entityId, selector)` · `graph.upsertNode` · `graph.upsertEdge` · `graph.stage(candidate)` (hold without committing)
- `dedupe.match(candidate)` → existing entity candidates + confidence
- `entity.resolve(identifiers)` → entityId

**Scoring / intel**
- `score.run(entityId)` → SRS, lane completeness, element count
- `maprank.query(entityId, keyword, geo, gridspec)` → per-point ranks, AR, SoV (external provider)
- `citation.query(entityId, prompt, engine)` → cited/not + position (per-LLM)
- `compset.query(category, geo)` → competitor list + ranks

**Relationship / delivery**
- `tts.synthesize(text, voice)` → NORA audio
- `email.send` · `sms.send` · `push.send`
- `entitlement.check(account, sku)` · `entitlement.grant` · `billing.meter(account, sku, qty)`
- `event.emit(type, payload)` (telemetry/attribution bus)

---

## 5. The Skills Registry

Grouped by capability area. Order within the doc ≈ dependency/build order.

---

### 5.1 Sourcing & Ingestion

---

#### `source.sync`
- **summary:** Confirm, scrape, or re-scrape a known first-party source (website, GMB) under a freshness gate.
- **tools:** `crawl.site`, `page.fetch`, `html.parse`, `jsonld.parse`, `nlp.extract`, `geocode`
- **reads:** source registry, staleness model, existing graph for this source
- **writes:** staged nodes/signals (not yet committed), source freshness timestamp
- **inputs:** `{entityId, sourceKind: website|gmb, url}` → **outputs:** staged node package + freshness verdict
- **preconditions:** a candidate source URL exists (from anchor profile, claim, or discovery)
- **behavior by group:**
  - **G-CLAIM / G-RETURN (CONFIRM):** source already crawled → return *confirm* mode ("Good news, I already have it") unless stale; re-scrape only if past the freshness window (≤ monthly).
  - **G-COLD (COLD-BUILD):** no prior crawl → force *scrape*; this is the entity's first data. If the user typed a URL at create-new, validate it resolves and belongs to them before trusting it.
- **provenance:** sets `inferred`, `source_hop = 1`
- **compliance:** `safe-autonomous`
- **commercial:** `free`
- **run mode:** scripted, autonomous (refresh), on-demand
- **degradation:** fetch fail → mark source `unreachable`, continue with other sources; never block the interview on one source.
- **emits:** `source.synced` (with node count), freshness telemetry
- **human touchpoint:** the "I already have it / linked off your Experience.com profile" card
- **notes:** two registered instances share this skill — `source.sync@website`, `source.sync@gmb` — differing only in parser profile.

---

#### `harvest.hop2`
- **summary:** From a *confirmed* first-party source, follow outbound links to other owned first-party properties and pull them (the "double bounce").
- **tools:** `page.fetch`, `html.parse`, `nlp.extract`, `dedupe.match`, `graph.stage`
- **reads:** confirmed source nodes, link graph
- **writes:** staged candidate sources + nodes
- **inputs:** `{entityId, confirmedSourceId}` → **outputs:** staged first-party candidates (hop-2)
- **preconditions:** at least one source confirmed (`claim.verify` or `source.sync` succeeded)
- **behavior by group:**
  - **G-CLAIM / G-RETURN:** standard — hop from confirmed website/GMB.
  - **G-COLD:** runs only *after* `claim.create_new` + first `source.sync` succeed; until there's a confirmed anchor, hop-2 has nothing to bounce from (skipped, not failed).
- **provenance:** `inferred`, `source_hop = 2`
- **compliance:** `safe-autonomous`
- **commercial:** `free`
- **run mode:** scripted, autonomous
- **degradation:** no outbound owned links → no-op (not an error).
- **emits:** `hop2.harvested`
- **human touchpoint:** feeds the next "is this you?" set; not a screen of its own.

---

#### `discovery.open_web`
- **summary:** The `[category] [name] [geo]` SERP sweep — collect first-page relevant results, dedupe against the graph, stage for confirmation. **Lower trust than first-party → never auto-commits.**
- **tools:** `serp.fetch`, `page.fetch`, `html.parse`, `dedupe.match`, `graph.stage`
- **reads:** category, name, geo, existing graph
- **writes:** staged open-web candidates (held for confirmation)
- **inputs:** `{entityId|identityHints, category, name, geo}` → **outputs:** classified candidate list
- **preconditions:** an identity (name + category + geo). Note: **does not require an entityId** — this is why it can run in G-COLD.
- **behavior by group:**
  - **G-CLAIM / G-RETURN (augment):** sweep runs against the established identity; results shown as "tap the ones that are you."
  - **G-COLD (primary build):** this becomes the *main* graph-building mechanism, not an augmentation — there's no ETL graph to augment. It runs on the identity hints the user typed at create-new, and its confidence bar is **raised** (more candidates require explicit confirmation) because there's no first-party anchor to cross-check against.
- **provenance:** staged only; promoted to `owner_verified` by `claim.verify`, else discarded
- **compliance:** `safe-autonomous` (discovery) — commitment is `consent-gated` via claim
- **commercial:** `free`
- **run mode:** scripted, autonomous (periodic re-sweep for new mentions), on-demand
- **degradation:** SERP provider down → retry/queue; interview proceeds with first-party set and flags discovery as "still looking."
- **emits:** `discovery.candidates` (count, by lane)
- **human touchpoint:** the "here's what's in your search results — tap the ones that are you / Add N to my graph" screens.
- **notes:** has distinct **states by access**, per your example — see the state table in §5.2 `candidate.classify` and `claim.verify`, which it feeds.

---

#### `extract.nodalize`
- **summary:** Turn parsed source content into typed graph nodes/signals under the intake contract (name, title, about, products, hours, license, etc.).
- **tools:** `nlp.extract`, `jsonld.parse`, `geocode`, `graph.stage`
- **reads:** intake contract / completeness ledger, staged raw content
- **writes:** staged typed nodes/signals
- **inputs:** raw parsed content → **outputs:** typed node package
- **behavior by group:** identical mechanism all groups; **volume differs** — G-COLD produces far fewer nodes initially (only what discovery + user input yield) and leans harder on `enrich.request`.
- **provenance:** carries through source hop/precedence of its input
- **compliance:** `safe-autonomous`
- **commercial:** `free`
- **run mode:** scripted, autonomous
- **degradation:** low field yield → trip the field-yield gate; flag lanes as thin for `plan.generate`.
- **emits:** `nodes.extracted` (by lane), completeness delta
- **notes:** this is the existing nodalizer, wrapped as a skill.

---

#### `media.capture` / `reviews.capture`
- **summary:** Ingest images as media nodes and reviews as review nodes.
- **tools:** `vision.ingest`, `ocr`, `nlp.extract`, `graph.stage`
- **reads:** source pages, review sources
- **writes:** media nodes, review nodes + aggregate signals
- **behavior by group:**
  - **G-RETURN:** must **reconcile** with reviews/media the account may already own on Experience.com (don't duplicate; owner-verified prior data wins).
  - **G-CLAIM:** ingest inferred; **G-COLD:** typically empty until sources grow.
- **provenance:** `inferred` (scraped) or `owner_verified` (from the owned account, G-RETURN)
- **compliance:** `safe-autonomous`; review *content* display is `restricted(vertical)` where regulated
- **commercial:** `free`
- **run mode:** scripted, autonomous
- **emits:** `media.captured`, `reviews.captured` (count, rating rollup)

---

#### `extract.{category}` — category-specialized extraction family
- **summary:** Category-specific specializations of `extract.nodalize` that know a category's signature content. Same contract, different parsers/schemas.
- **members (examples):** `extract.menu` (restaurant — dishes, prices, sections, delivery-platform pull, reservations — a *heavy* build), `extract.products` (loan officer — loan types, rates), `extract.listings` (realtor — active/sold, specialties, transactions), `extract.services` (generic service businesses).
- **tools:** `crawl.site`, `html.parse`, `nlp.extract`, per-category parsers, `graph.stage`
- **reads:** category module config, source content → **writes:** staged category nodes/signals
- **behavior by group:** same as `extract.nodalize`; *which member runs* and volume are set by the Interview Template (§5.7.7).
- **compliance:** `safe-autonomous` · **commercial:** `free` (cost-heavy members may be `metered`) · **run mode:** scripted, autonomous
- **notes:** this family is *why* "the interview" is category-specific — a restaurant's menu ingestion is a different, larger job than a loan officer's product list.

---

### 5.2 Identity, Claim & Verification — The Claim Gate

The claim gate is the platform's conversion chokepoint and its security boundary at once. **Design principle: silent-first, risk-based, graduated trust.** We already hold most of the proof (Place ID, GBP management via our own Google APIs, the graph's domain/social signals), so NORA verifies from what we own *before* asking the user anything, asks for the smallest possible thing only when the silent check falls short, explains *why*, and raises the bar only for genuine ambiguity. Friction is concentrated on risk, not spread across everyone.

Grounded in risk-based/step-up authentication practice and NIST SP 800-63 (IAL proofing vs. AAL login strength): **proofing assurance can be high with zero user effort when the verifier already holds the evidence** — which we do.

**The three things the gate decides, per attempt:**
1. Is this the owner? (proofing confidence)
2. How much power is being requested? (trust tier)
3. What is the smallest challenge that closes the gap between 1 and 2?

**Trust tiers — power scales with proof, not with entry:**
- **T0 — Authenticated.** One-tap OAuth. Unlocks: view, preview, start the interview in a sandbox. No public changes.
- **T1 — Identity-matched + verified email.** Unlocks: organize/confirm the graph, set the work agreement.
- **T2 — Ownership-proven.** Unlocks the dangerous actions — change published NAP, publish, suppress/alter competitive signals, buy. **This is the competitor firewall.**

**The silent-pass path (the majority):** Google OAuth + our stored Place ID matches a location the user manages → **instant T2, no challenge.** The lowest-friction route is also the highest-assurance one. Domain-email and social-graph matches can clear **T1** silently.

**The conversational flow (plain English):** Click Claim → drops into NORA → `claim.authenticate` → `claim.silent_precheck` (scores from held signals; if it clears, "Verified — welcome," done) → only if short, `claim.challenge` (one explained, auto-filled OTP to an on-file channel, which also verifies contact info) → only if that's impossible or T2 is needed, `claim.verify_ownership` (GBP-manage match, or the alternate-channel + live re-lookup path for owners whose info changed). An imposter clears none of these and is stopped before access, without ever being accused.

**The one tunable dial:** the **silent-pass confidence bar** (false-accept vs. false-reject). Set by action impact and tuned on real conversion+fraud data — never a flat threshold. Because we hold GBP-management match for most of the universe, the bar can be set high on safety while still passing most owners silently.

---

#### `candidate.classify`
- **summary:** For each discovered item, assign lane + node type + **match-confidence** to the anchor identity. Powers both "pre-checked, add N" and disambiguation.
- **tools:** `dedupe.match`, `nlp.extract`, embeddings/similarity
- **reads:** anchor identity (name, license, geo, photo signals), candidate
- **writes:** classification + confidence onto staged candidates
- **inputs:** staged candidate → **outputs:** `{lane, nodeType, confidence, conflicts[]}`
- **behavior by group:**
  - **G-CLAIM / G-RETURN:** rich anchor → high-precision matching; high-confidence items pre-checked.
  - **G-COLD:** weak anchor (only user-typed hints) → **confidence bar raised**, fewer pre-checks, more "are you sure this is you?" The absence of a first-party anchor means classify leans on user confirmation rather than cross-source agreement.
- **compliance:** `safe-autonomous`
- **commercial:** `free`
- **run mode:** scripted, autonomous
- **emits:** `candidates.classified`
- **notes:** the confidence threshold is a tunable governed by group; this is where the "wrong Joy" gets its low score (see `identity.disambiguate`).

---

#### `claim.verify`
- **summary:** The "This is me" action. Promotes staged inferred data to `owner_verified` and binds the entity to the account.
- **tools:** `graph.upsertNode`, `graph.upsertEdge`, `entity.resolve`, `entitlement.grant`
- **reads:** staged candidates, account
- **writes:** commits nodes with `provenance = owner_verified`, `verified_by`, `verified_at`; binds account↔entity
- **inputs:** `{accountId, entityId, acceptedCandidateIds[]}` → **outputs:** committed verified subgraph
- **preconditions:** identity established (claim or auth)
- **behavior by group:**
  - **G-CLAIM:** the golden path — bulk-confirm the inferred graph.
  - **G-RETURN:** much of the graph may already be owner-verified via the account; claim.verify only covers *newly discovered* items; **don't re-ask what the account already confirmed.**
  - **G-COLD:** verifies the thin cold-built set the user just assembled.
- **provenance:** sets `owner_verified` (this is the single most valuable write in the system — the Experience.com-side asset)
- **compliance:** `consent-gated` (the tap *is* the consent)
- **commercial:** `free`
- **run mode:** scripted, on-demand
- **degradation:** partial accept → commit accepted, leave rest staged.
- **emits:** `claim.verified` (node count, lanes) — **primary activation event**
- **human touchpoint:** every "Yes, this is my site / this is mine / Add N to my graph" control.

---

#### `claim.create_new`  *(net-new — the G-COLD front door)*
- **summary:** Handle "Create new" when no profile was found. **Runs a secondary lookup first** to avoid duplicate entities, then establishes a cold entity and triggers acquisition.
- **tools:** `serp.fetch`, `dedupe.match`, `entity.resolve`, `graph.upsertNode`
- **reads:** index (full), user-typed identity
- **writes:** either (a) promotes user to G-CLAIM against a found entity, or (b) creates a new `owner_verified` seed entity
- **inputs:** `{identity: name, category, geo, url?}` → **outputs:** `{resolution: matched|created, entityId, promotedGroup?}`
- **preconditions:** none (this is the entry skill for G-COLD)
- **behavior by group:** G-COLD only. **Secondary lookup is mandatory and user-confirmed** — search index + web for a likely-existing profile under name/category/geo variants. If a candidate is found → **show it and ask, in NORA's voice, "Quick check — I searched our profiles. Are you sure this isn't you?"** On "that's me," route into the claim path (`claim.match`/`claim.verify`); **never silently merge or promote.** Only if the user confirms it is genuinely absent → create a seed entity, stamp `owner_verified` on user-entered facts, and **trigger `source.sync` in scrape mode + `discovery.open_web` as primary build.**
- **provenance:** user-entered facts `owner_verified`, `source_hop = 0`; everything else built cold thereafter
- **compliance:** `consent-gated` + `human-review-required` on the create decision (prevent accidental duplicates)
- **commercial:** `free`
- **run mode:** scripted
- **degradation:** ambiguous secondary match → present "is this you?" rather than silently creating.
- **emits:** `entity.created` or `claim.promoted`
- **human touchpoint:** the Create-new flow + a "we found someone who might be you — is this you?" interstitial.
- **notes:** this skill is the reason G-COLD doesn't corrupt the graph. It is the dedupe firewall for user-initiated entities.

---

#### `identity.disambiguate`
- **summary:** Detect and wall off wrong-entity matches (the "different Joy" — different license/state/photo). Negative verification.
- **tools:** `dedupe.match`, `nlp.extract`, similarity
- **reads:** anchor identity, candidate, license/geo/photo signals
- **writes:** `owner_rejected` on the mismatch; exclusion edge so it never re-surfaces
- **inputs:** staged candidate flagged low-confidence or conflicting → **outputs:** keep / reject recommendation
- **behavior by group:** all groups; **more active in G-COLD** (weak anchor → more false positives to reject) and important in G-RETURN (prevent merging someone else's data into an established account).
- **provenance:** `owner_rejected` (a confirmed exclusion is a durable asset — don't rescan it)
- **compliance:** `consent-gated` (owner confirms "not me"); NORA may *propose* autonomously
- **commercial:** `free`
- **run mode:** scripted, autonomous (flag), on-demand
- **emits:** `identity.rejected`
- **human touchpoint:** "after a deeper look, I don't think this one is you — remove it."

---

#### `claim.initiate`
- **summary:** The front door — "Claim" is clicked, NORA opens and sets the frame ("my first job is to make sure only you can touch your profile"). Routes found-profile vs. create-new.
- **tools:** — (kernel + UI)
- **reads:** the target profile (if any), category
- **writes:** a claim session
- **behavior by group:** G-CLAIM/G-RETURN → found path; no match → hands to `claim.create_new`.
- **compliance:** `safe-autonomous` · **commercial:** `free` · **run mode:** scripted
- **emits:** `claim.started`
- **human touchpoint:** the claim explainer; NORA greeting.

---

#### `claim.authenticate`
- **summary:** Establish identity — Google OAuth (preferred, carries the GBP signal + verified email), or social/email. Captures device/geo signals for the risk score.
- **tools:** OAuth providers, `email.send` (fallback verify)
- **writes:** authenticated identity, verified email (when provided by IdP), device/session signals
- **behavior by group:** G-RETURN → existing session may already satisfy this. G-COLD/G-CLAIM → fresh OAuth.
- **provenance:** verified email → security anchor + feeds `contact_policy`
- **compliance:** `consent-gated` · **commercial:** `free` · **run mode:** scripted
- **emits:** `claim.authenticated`
- **notes:** prefer Google for the dual payoff (lowest friction + strongest proof). Passwordless/passkey where available.

---

#### `claim.silent_precheck`  *(the core zero-friction step)*
- **summary:** Score ownership confidence from signals **already held** — before asking the user anything — and recommend a tier or the smallest needed challenge.
- **tools:** `maprank`/GBP-manage lookup, `dedupe.match`, graph signal correlation
- **reads:** authenticated identity, stored Place ID, graph (domain/social/phone nodes), device/geo
- **writes:** `{confidence, recommended_tier, challenge_needed?}`
- **signals (weighted):** GBP management match on stored Place ID (dispositive → T2) · OAuth email domain = profile website domain (strong → T1) · OAuth social identity = graph social node (strong) · device/geo consistency (supporting)
- **behavior by group:** G-COLD → little to check (thin graph) → usually falls to challenge. G-CLAIM/G-RETURN → often clears silently.
- **compliance:** `safe-autonomous` · **commercial:** `free` · **run mode:** scripted
- **emits:** `precheck.scored` (confidence, tier)
- **notes:** the **silent-pass bar** is the tunable dial — set by action impact, tuned on real conversion+fraud data.

---

#### `claim.challenge`
- **summary:** The one low-friction step-up when the silent check is short — a possession check on a channel **already on the profile** (OTP). Auto-filled code, channel fallback. Doubles as contact verification.
- **tools:** `sms.send`, `email.send`, OTP verify
- **reads:** on-file phone/email from the graph
- **writes:** verified channel → T1; the verified channel also seeds `contact_policy`
- **behavior by group:** same across groups; channels differ by what's on file.
- **compliance:** `consent-gated` · **commercial:** `free` · **run mode:** scripted
- **degradation:** SMS fail → offer email/alternate; **measure this step as its own funnel stage** (it's the classic drop-off point); never leave the user with a single failing channel.
- **emits:** `challenge.sent`, `challenge.passed|failed`, `email.verified`
- **human touchpoint:** "I can text the number ending 3681 or email a---@---.com — which do you have?"

---

#### `claim.verify_ownership`  *(step-up to T2 / the hard cases)*
- **summary:** Prove ownership strongly enough to unlock published-change / buy power, and handle the "I don't control the on-file channel" case without a dead end.
- **tools:** GBP Account Management (managed-location match), domain-email verify, `sms.send`, `serp.fetch` (re-lookup), manual-review queue
- **reads:** stored Place ID, identity, graph, alternate channel supplied by user
- **writes:** T2 grant evidence
- **paths (in order of preference):**
  1. **GBP management match** (Google OAuth → managed locations include our Place ID) → **instant T2, short-circuits everything.** Primary path for most of the universe.
  2. Domain email / on-file phone possession → T2 for most actions.
  3. **No on-file channel (owner changed info):** take an alternate channel, run a **live online re-lookup** to re-confirm it ties to this person/business, require a second independent signal (or short manual/doc review). Raises the bar — **does not block.**
- **behavior by group:** G-RETURN → never overwrite account-owned facts without this. G-COLD → rarely reaches T2 until the graph grows.
- **compliance:** `consent-gated` → `human-review-required` for the re-lookup path · **commercial:** `free` · **run mode:** scripted, on-demand
- **emits:** `ownership.verified` (tier, path)
- **notes:** the competitor firewall lives here — an imposter clears no path and simply can't produce proof.

---

#### `claim.disambiguate_self`
- **summary:** The user matches several of **their own** profiles (multi-location, multi-category) → "which are you? claim all that apply."
- **tools:** `dedupe.match`, graph query
- **writes:** multiple claim bindings
- **compliance:** `consent-gated` · **commercial:** `free` · **run mode:** scripted
- **emits:** `self.disambiguated`
- **notes:** distinct from `identity.disambiguate` (which *rejects others'* data); this *selects among the user's own* candidates.

---

#### `claim.delegate`  *(GTM-critical — the agency path)*
- **summary:** Authorized-agent claim — an assistant, team admin, or **marketing agency** claims/manages on behalf of the owner, with its own authorization proof.
- **tools:** OAuth, authorization-grant record, `email.send` (owner notice)
- **reads:** delegator identity, target entity, authorization evidence
- **writes:** delegated binding (agent↔entity) with scope + an owner notification
- **behavior by group:** all; **first-class for the agency channel** (channel #1 of GTM = delegated claiming at scale).
- **compliance:** `consent-gated` + owner notification; `human-review-required` for high-power scopes · **commercial:** `free` · **run mode:** scripted, on-demand
- **emits:** `claim.delegated`
- **notes:** owner retains override/revoke; delegated power is scoped and auditable.

---

#### `claim.resolve_conflict`
- **summary:** Target profile is already claimed — route accordingly.
- **tools:** GBP `requestAdminRightsUrl`, dispute queue
- **behavior:** claimed by **this** user earlier → just log in. Claimed by **someone else** → Google-native access-request (`requestAdminRightsUrl`) or internal dispute flow; never silent takeover.
- **compliance:** `human-review-required` (disputes) · **commercial:** `free` · **run mode:** scripted, on-demand
- **emits:** `claim.conflict`, `claim.dispute_opened`

---

#### `claim.grant`
- **summary:** Bind account↔entity at the earned trust tier and stamp provenance. The commit of the gate.
- **tools:** `entity.resolve`, `entitlement.grant`, `graph.upsertEdge`
- **writes:** account↔entity binding + `trust_tier`; owner-confirmed facts → `owner_verified`
- **compliance:** `consent-gated` · **commercial:** `free` · **run mode:** scripted
- **emits:** `claim.granted` (tier) — **the claim-complete activation event**
- **notes:** distinct from `claim.verify` (which confirms *data* during the interview); `claim.grant` establishes the *relationship + power level*.

---

#### `claim.release`  *(unclaim)*
- **summary:** One-tap, reversible unclaim.
- **tools:** `graph.upsertEdge` (unbind)
- **writes:** removes account↔entity binding; **keeps the graph intact** (the verified data is a durable asset)
- **open decision:** on release, do owner-verified facts stay `owner_verified`, revert to `inferred`, or flag `pending_reclaim`? (Affects the asset-survives thesis — your call.)
- **compliance:** `consent-gated` · **commercial:** `free` · **run mode:** on-demand
- **emits:** `claim.released`

---

#### `interview.reset`
- **summary:** Reset journey progress to re-run the interview; **keeps the graph.**
- **tools:** journey state
- **writes:** clears stage progress; graph + provenance untouched
- **compliance:** `safe-autonomous` · **commercial:** `free` · **run mode:** on-demand
- **emits:** `interview.reset`

---

#### `claim.verify_email`
- **summary:** Ensure a verified email exists early — security anchor + the channel `contact_policy` depends on.
- **tools:** `email.send`, verify
- **behavior:** satisfied automatically by Google/work OAuth; otherwise rides along with `claim.challenge`, or is captured as a deferred *value* step ("so I can send you your wins") when claim passed silently — progressive profiling, never a cold gate.
- **compliance:** `consent-gated` · **commercial:** `free` · **run mode:** scripted, on-demand
- **emits:** `email.verified`

---

### 5.3 Reconciliation

---

#### `conflict.detect`
- **summary:** Find NAP collisions, hours mismatches, and duplicate facts across sources.
- **tools:** `graph.query`, `dedupe.match`
- **reads:** committed + staged nodes across sources
- **writes:** conflict records (grouped by field)
- **behavior by group:**
  - **G-CLAIM:** rich conflicts (multiple addresses/phones/hours — the demo).
  - **G-RETURN:** also diff against **account-owned** values; a prior owner-verified value outranks a freshly scraped one.
  - **G-COLD:** usually few/no conflicts initially (thin data); re-runs as the graph grows.
- **compliance:** `safe-autonomous`
- **commercial:** `free`
- **run mode:** scripted, autonomous
- **emits:** `conflicts.detected` (by type)

---

#### `conflict.resolve`
- **summary:** Apply the owner's choice (or precedence rule) → write canonical value, demote the rest, propagate.
- **tools:** `graph.upsertNode`, `graph.upsertEdge`
- **reads:** conflict records, owner choice
- **writes:** canonical value `owner_verified`; demoted alternates retained with lowered precedence; "fix everywhere" propagation
- **inputs:** `{conflictId, choice|auto}` → **outputs:** resolved field + propagation report
- **behavior by group:**
  - **owner-present (interview):** owner picks (primary/secondary/retire, cell/fax, which hours).
  - **autonomous (J4):** NORA may auto-resolve **only** `safe-autonomous`-classed conflicts by precedence (e.g., obvious dedupe); anything that changes a *published* NAP fact is `consent-gated`.
  - **G-RETURN:** never silently overwrite an account-owned value — propose.
- **provenance:** canonical → `owner_verified` (interview) or `system_derived` (autonomous precedence)
- **compliance:** `consent-gated` for published-fact changes; `safe-autonomous` for pure dedupe
- **commercial:** `free`
- **run mode:** scripted, autonomous, on-demand
- **emits:** `conflict.resolved`, `nap.canonicalized`
- **human touchpoint:** the address/phone/hours resolver cards ("Looks right — fix it everywhere," "Sync my real hours").

---

#### `enrich.request`
- **summary:** Ask the human for a field NORA can't source (the missing mobile). The *only* skill that requires human input to complete — and even it degrades gracefully.
- **tools:** (UI prompt) + `graph.upsertNode`
- **reads:** completeness ledger (gaps)
- **writes:** `owner_verified` value when provided
- **behavior by group:** **heaviest in G-COLD** (thin graph → more gaps). In G-CLAIM/G-RETURN, used sparingly for high-value missing fields only.
- **provenance:** `owner_verified`, `source_hop = 0`
- **compliance:** `consent-gated`
- **commercial:** `free`
- **run mode:** scripted, on-demand
- **degradation:** **no answer ≠ blocked.** Per the "no critical path through the human" rule, every `enrich.request` has a fallback: skip, infer later, or offer a paid/autonomous alternative. NORA never stalls waiting.
- **emits:** `enrich.requested`, `enrich.fulfilled`
- **human touchpoint:** "I'm still missing a mobile — that's how I'll text you."

---

### 5.4 Graph & Scoring

---

#### `graph.upsert`
- **summary:** Commit nodes/signals/media/edges with the provenance envelope. The one write path into the graph.
- **tools:** `graph.upsertNode`, `graph.upsertEdge`, `dedupe.match`
- **writes:** committed graph with `{provenance_state, source_hop, verified_by, verified_at, precedence}`
- **behavior by group:** identical contract; **G-COLD passes through `claim.create_new`'s dedupe gate first.**
- **compliance:** `safe-autonomous` (for `inferred`/`system_derived`); verified writes come via `claim.verify`
- **commercial:** `free`
- **run mode:** all
- **notes:** idempotent upsert keyed on entity+node identity; never create duplicates — always `dedupe.match` first.

---

#### `graph.rollup`
- **summary:** Compute per-lane completeness, node/signal/photo counts, fill %.
- **tools:** `graph.query`, `score.run`
- **reads:** committed graph
- **writes:** rollup cache
- **behavior by group:** same; numbers simply differ (G-COLD starts near-zero).
- **compliance / commercial:** `safe-autonomous` / `free`
- **run mode:** all
- **emits:** `rollup.computed`
- **human touchpoint:** "Your organized internet — 95 nodes, 1,636 signals, 90 photos, 96% filled" + the lane bars.

---

#### `score.compute`
- **summary:** Run the SRS / expertise-element score.
- **tools:** `score.run`
- **reads:** graph + rollup
- **writes:** score history (time series — needed for attribution)
- **behavior by group:** same engine; **store every run** so the proof loop can show deltas over time.
- **compliance / commercial:** `safe-autonomous` / `free`
- **run mode:** all
- **emits:** `score.computed` (with delta vs. last)
- **notes:** existing engine, wrapped. The time-series storage is the new requirement — it feeds `proof`/attribution.

---

#### `graph.visualize`
- **summary:** Produce the radial expertise-graph render payload.
- **tools:** `graph.query`
- **reads:** committed graph
- **writes:** none (render payload)
- **behavior by group:** same; sparse in G-COLD.
- **compliance / commercial:** `safe-autonomous` / `free`
- **run mode:** scripted, on-demand
- **human touchpoint:** the radial node map ("tap any node to open its package").

---

### 5.5 Competitive Intelligence

---

#### `competitor.resolve`
- **summary:** Build the comp-set for this entity's category + geo.
- **tools:** `compset.query`, `graph.query`
- **reads:** category, geo, graph
- **writes:** snapshot.competitors[]
- **behavior by group:** same across groups — competitor reality is independent of the user's data state. **Works even in G-COLD** (it's about the market, not the user), which is useful: NORA can show a cold user who's winning *before* their graph is built, as a hook.
- **compliance:** `safe-autonomous`
- **commercial:** `free` (basic set); deep comp detail may be `paid-unlock`
- **run mode:** scripted, autonomous (refresh), on-demand
- **emits:** `compset.resolved`
- **human touchpoint:** "here are the five names taking the calls that should be yours."

---

#### `maprank.pull`
- **summary:** Geo-grid scan → per-point ranks, average rank, share-of-voice, good/avg/poor/out-of-20.
- **tools:** `maprank.query`
- **reads:** entity, keyword set, geo, grid spec
- **writes:** snapshot.maprank (+ history for staleness/attribution)
- **behavior by group:** same; **G-COLD** can still pull for the category/geo to seed the hook. **Cost-bearing external calls** → cache hard, honor the staleness model.
- **compliance:** `safe-autonomous`
- **commercial:** `metered` (external provider cost) — basic cadence `free`, higher frequency `paid-unlock`
- **run mode:** scripted, autonomous (scheduled refresh), on-demand
- **degradation:** provider limit → serve last snapshot with a staleness badge.
- **emits:** `maprank.pulled` (AR, SoV, delta)
- **human touchpoint:** the 5-mile grid + AR/SoV cards.
- **notes:** **the single most expensive skill to run at scale.** Metering + staleness are mandatory, not optional.

---

#### `citation.pull`
- **summary:** Per-LLM citation rate — does each engine name the entity for category+geo prompts.
- **tools:** `citation.query` (per engine: ChatGPT, Gemini, Claude, Perplexity, Grok)
- **reads:** entity, prompt set, engines
- **writes:** snapshot.citations (+ history)
- **behavior by group:** same; cost-bearing (LLM calls) → cache + cadence-gate.
- **compliance:** `safe-autonomous`
- **commercial:** `metered` / higher cadence `paid-unlock`
- **run mode:** scripted, autonomous, on-demand
- **degradation:** engine unavailable → report per-engine coverage, don't fail the panel.
- **emits:** `citation.pulled` (per-engine %, delta)
- **human touchpoint:** the AI-answer-engines panel.

---

#### `competitor.select_target`
- **summary:** Pick the one rival to anchor the relationship on ("getting you past Quad City Bank & Trust").
- **tools:** (reasoning over snapshot)
- **reads:** snapshot (comp-set, maprank)
- **writes:** goal.target_competitor, goal.target_rank
- **behavior by group:** same logic; in G-COLD the target is set from market data and refined once the user's graph exists.
- **compliance:** `safe-autonomous`
- **commercial:** `free`
- **run mode:** scripted, autonomous (re-evaluate as ranks move)
- **emits:** `target.selected`
- **human touchpoint:** "my whole job from here is getting you past [X]."
- **notes:** sets the **goal state** the perpetual loop optimizes against. This is where the interview hands off to the standing agent.

---

### 5.6 Planning & Relationship

---

#### `plan.generate`  *(the Ledger seed — the paywall)*
- **summary:** Diff the entity's graph against the winners' graphs → ranked gap list, each item FIX/MISSING/STRONG, lane-tagged, product-tied, **commercial-classed**. Output *is* the Opportunity Ledger.
- **tools:** `graph.query`, `score.run`, `compset.query`
- **reads:** graph, snapshot, goal, product catalog, entitlements
- **writes:** **Ledger items** `{lane, status, action, owner_effort, nora_action, commercial_class, product_sku?, expected_lift, target_competitor}`
- **inputs:** `{entityId, target_competitor}` → **outputs:** ranked Ledger
- **behavior by group:**
  - **G-CLAIM / G-RETURN:** full graph-vs-winners diff.
  - **G-COLD:** plan is dominated by "build the basics" items (the graph itself is the gap); competitive items appear as the graph fills.
  - **G-RETURN:** respect existing entitlements — don't pitch a tool they already own; show it as active.
- **compliance:** `safe-autonomous` to *generate*; each item inherits the compliance class of the skill that would execute it
- **commercial:** the Ledger is where `free` / `metered` / `paid-unlock` items are surfaced — **this is the store and the plan in one object.**
- **run mode:** scripted, autonomous (daily refresh), on-demand
- **emits:** `plan.generated`, `ledger.updated`
- **human touchpoint:** the "Graph vs. the winners" FIX/MISSING list; later, the standing Ledger.
- **notes (integrity rule):** an item is only `paid-unlock` if the paid action genuinely moves `expected_lift` for *this* entity. NORA never surfaces a tool that won't help — that discipline protects the entire retention/trust model.

---

#### `contact_policy.set`  *(the work agreement)*
- **summary:** Capture when/how NORA may contact the owner — days, time window, channels, consent — and bind all future outreach to it.
- **tools:** `graph.upsertNode`, `entitlement.grant` (consent record)
- **reads:** account
- **writes:** contact_policy `{days[], window, channels[], consent_flags, quiet_hours}`
- **behavior by group:**
  - **G-CLAIM / G-COLD:** set during the interview (the demo's Tue/Thu + late-morning + text/email).
  - **G-RETURN:** pre-populate from existing account comms prefs; confirm rather than ask cold.
- **provenance:** `owner_verified` consent
- **compliance:** `consent-gated` — this skill *is* the consent ledger every delivery skill checks
- **commercial:** `free`
- **run mode:** scripted, on-demand (editable anytime)
- **emits:** `policy.set`
- **human touchpoint:** the best-days / best-time / text-me / email-me work-agreement screen.
- **notes:** **every** autonomous/outreach skill (`communicate`, nudges, campaigns) must gate on this. No contact policy → no outreach, full stop.

---

#### `assistant.chat`
- **summary:** The persistent "Ask NORA anything" — NORA reasoning over the world-model, able to invoke any skill on request (within consent/compliance).
- **tools:** (kernel + registry access)
- **reads:** full world-model
- **writes:** via invoked skills
- **behavior by group:**
  - **G-COLD / pre-interview:** limited to what's known; steers toward completing the build.
  - **G-RETURN / J4:** full capability, history-aware.
- **compliance:** inherits the class of whatever skill it invokes; chat itself `safe-autonomous`
- **commercial:** `free` to converse; invoked `paid-unlock` skills still gate.
- **run mode:** on-demand (always available once seated)
- **emits:** `chat.turn`, plus whatever invoked skills emit
- **human touchpoint:** the chat box + suggested chips ("What did you find?", "What should I fix first?").

---

#### `narrate`
- **summary:** The NORA voice/persona layer — scripts the step narration and (optionally) TTS.
- **tools:** `tts.synthesize`
- **reads:** current step, world-model facts to reference
- **writes:** none
- **behavior by group:** tone adapts — G-COLD is encouraging/build-oriented; G-RETURN is "welcome back, here's what changed."
- **compliance:** `restricted(vertical)` — narration must not make non-compliant claims about a licensed professional (no fabricated performance/÷guarantees).
- **commercial:** `free`
- **run mode:** scripted, autonomous (report narration), on-demand
- **notes:** persona/voice is a thin layer over the kernel, *not* a place where facts originate. It reads the world-model; it never invents.

---

### 5.7 The Kernel, Registry Contract & Interview Templates

This is the OS spine — the machine that runs every skill above, in both the interview and the perpetual loop.

#### 5.7.1 The Skill Descriptor (the registration contract)
Every skill registers a declarative descriptor the kernel reads. This is the USB-port contract: the fleet builds tools, skills declare this, the kernel does the rest.

```json
{
  "id": "claim.silent_precheck",
  "version": "1.0.0",
  "summary": "...",
  "tools": ["gbp.listManagedLocations", "dedupe.match"],
  "reads": ["identity", "graph", "placeId", "device"],
  "writes": ["claim_session.confidence"],
  "inputs_schema": { "...": "..." },
  "outputs_schema": { "confidence": "number", "recommended_tier": "T0|T1|T2" },
  "preconditions": ["authenticated"],
  "access_behavior": { "G_COLD": "...", "G_CLAIM": "...", "G_RETURN": "..." },
  "journey_stages": ["J1"],
  "provenance_effect": "none",
  "consent": "none",
  "compliance_class": "safe-autonomous",
  "commercial_class": "free",
  "sku": null,
  "run_modes": ["scripted"],
  "idempotency_key": "entity+account+session",
  "degradation": "fall through to claim.challenge",
  "emits": ["precheck.scored"],
  "metering": null
}
```

#### 5.7.2 The Kernel loop
Observe → decide → act → measure, in **two modes off one engine**:
- **Scripted (interview):** run an Interview Template's ordered skill list with human gates.
- **Autonomous (perpetual):** the planner selects the next-best skill from the Ledger against the goal, inside policy + `contact_policy` cadence.

**Invocation lifecycle — every call:** resolve access-state (group × stage × tier) → select skill(s) → **governance check** (consent, compliance class, entitlement) → execute (compose tools) → record provenance + outcome → emit events → advance world-model + journey stage.

#### 5.7.3 Registry mechanics
Registration, discovery (by capability / lane / category), **versioning** (skills are semver'd; templates pin versions), permissioning (which roles/tiers may invoke), and metering hooks. A skill is inert until registered; nothing invokes a tool directly except through a registered skill.

#### 5.7.4 Governance envelope (concrete)
Wraps every invocation: consent check against `contact_policy`/trust tier; compliance-class gate (`restricted` → compliance check before any output about a licensed professional); append to the audit log; and the **autonomy gate** — in autonomous mode the kernel may run only `safe-autonomous` skills until the governance + proof systems are mature. No exceptions, no autonomy before this exists.

#### 5.7.5 Monetization bridge (concrete)
`commercial_class` lives on the skill. When the planner's next-best action is `paid-unlock`, the kernel **emits a Ledger pitch instead of executing**; `entitlement.check` gates execution; the integrity rule holds — only surface the pitch if `expected_lift > 0` for *this* entity. Value and revenue are the same event.

#### 5.7.6 Attribution bus
Every skill emits outcome events. The proof loop joins action → metric delta (score / maprank / citation history) → the report (retention), the upsell justification (ladder), and the honesty check (did this skill actually help?). This is what keeps cumulative ARR from leaking.

#### 5.7.7 Interview Templates (the interview is category-specific)
The interview is **not one flow.** A template = **shared spine + category module.**

- **Spine (category-agnostic):** claim → organize (`source.sync`, `harvest.hop2`, `discovery.open_web`, `candidate.classify`, `claim.verify`) → reconcile (`conflict.*`) → `graph.rollup`/`score.compute` → competitive (`competitor.*`, `maprank.pull`, `citation.pull`) → `plan.generate` → `contact_policy.set`.
- **Category module:** declares the category-specific extraction + any extra steps. Examples: restaurant → `extract.menu` (+ reservations/delivery); loan officer → `extract.products` + NMLS license board; realtor → `extract.listings`.
- **Template descriptor:** `{ category | category_group, spine_version, modules[], extraction_skills[], step_overrides }`.
- **Granularity (open decision):** recommend **per-category-group templates with per-category overrides**, not 4,000 bespoke flows — one restaurant template serves all restaurants; overrides handle edge categories. Your call on how fine the groups are.

### 5.8 World-Model Objects (what skills read/write)

The kernel's state. Skills never hold truth; they read/write these.

- **graph** — nodes / signals / media / edges, each carrying the provenance envelope `{provenance_state, source_hop, verified_by, verified_at, precedence}`.
- **snapshot** — comp-set, maprank (AR, SoV, grid), citations — each with history for staleness + attribution.
- **ledger** — opportunity items `{lane, status(FIX/MISSING/STRONG), action, owner_effort, nora_action, commercial_class, sku?, expected_lift, target_competitor}`.
- **contact_policy** — `{days[], window, channels[], consent_flags, quiet_hours}`.
- **goal** — `{target_competitor, target_rank, horizon}`.
- **journey** — `{access_group, stage, trust_tier}` (per account↔entity binding).
- **account / entitlements** — identity, verified email, owned SKUs, delegation grants.

---

## 6. Cross-Cutting Systems

### 6.1 Provenance (the Experience.com-side asset)
Every node/signal carries `{provenance_state, source_hop, verified_by, verified_at, precedence}`. `claim.verify` producing `owner_verified` is the highest-value write in the platform — it's what makes even a one-and-done interview leave behind a user-verified profile. Conflict resolution is deterministic by precedence.

### 6.2 Consent & Compliance
The governance envelope wraps every skill invocation and enforces the skill's `compliance class` against the user's state and `contact_policy`. `restricted(vertical)` skills (anything that publishes claims about a licensed professional) require the compliance check before output. **No autonomous action runs before the envelope exists.**

### 6.3 Monetization bridge
`commercial_class` lives on the skill and is surfaced through the Ledger. When the next-best action for the goal is a `paid-unlock` skill, the kernel emits the pitch *as* the plan item. Value and revenue are the same event — gated by the integrity rule in `plan.generate`.

### 6.4 Attribution / proof loop
`score.compute`, `maprank.pull`, and `citation.pull` all store history. The proof loop ties each executed skill to its outcome delta, feeding the report (retention), the upsell justification (ladder), and the honesty check (did this skill actually help?). This is what protects the cumulative ARR from leaking.

### 6.5 Metering
`metered` skills (`maprank.pull`, `citation.pull`, media/LLM-heavy work) call `billing.meter`. At 40M entities these external-cost skills are the margin risk — cache aggressively, honor staleness, cadence-gate by tier.

---

## 7. Summary Matrix

| Skill | Group posture (COLD/CLAIM/RETURN) | Provenance write | Compliance | Commercial | Modes |
|-------|-----------------------------------|------------------|-----------|-----------|-------|
| source.sync | build / confirm / confirm | inferred h1 | safe-auto | free | S,A,O |
| harvest.hop2 | after-create / std / std | inferred h2 | safe-auto | free | S,A |
| discovery.open_web | **primary** / augment / augment | staged→verified | safe-auto | free | S,A,O |
| extract.nodalize | thin / full / full | inherits | safe-auto | free | S,A |
| media/reviews.capture | empty / infer / **reconcile** | inferred/verified | safe-auto* | free | S,A |
| candidate.classify | high-bar / precise / precise | — | safe-auto | free | S,A |
| claim.verify | thin set / **golden** / delta-only | **owner_verified** | consent | free | S,O |
| claim.create_new | **only** (dedupe gate) | owner_verified h0 | consent+review | free | S |
| identity.disambiguate | heavy / std / guard-merge | owner_rejected | consent | free | S,A,O |
| conflict.detect | few / rich / vs-account | — | safe-auto | free | S,A |
| conflict.resolve | few / owner-pick / propose | verified/derived | consent* | free | S,A,O |
| enrich.request | heavy / light / light | owner_verified h0 | consent | free | S,O |
| graph.upsert | via create-gate / std / std | envelope | safe-auto | free | all |
| graph.rollup | ~0 / full / full | — | safe-auto | free | all |
| score.compute | low / full / full | history | safe-auto | free | all |
| graph.visualize | sparse / full / full | — | safe-auto | free | S,O |
| competitor.resolve | market-only / std / std | — | safe-auto | free/unlock | S,A,O |
| maprank.pull | market / std / std | history | safe-auto | **metered** | S,A,O |
| citation.pull | market / std / std | history | safe-auto | **metered** | S,A,O |
| competitor.select_target | provisional / set / set | goal | safe-auto | free | S,A |
| plan.generate | build-basics / diff / diff(own-aware) | ledger | safe-auto→inherit | **store** | S,A,O |
| contact_policy.set | set / set / confirm | verified consent | consent | free | S,O |
| assistant.chat | limited / full / full | via skills | inherit | free/gate | O |
| narrate | build-tone / std / welcome-back | — | restricted | free | S,A,O |

*Modes: S=scripted interview, A=autonomous loop, O=on-demand/chat.*

**Claim-gate skills**

| Skill | Role | Provenance write | Compliance | Commercial | Modes |
|-------|------|------------------|-----------|-----------|-------|
| claim.initiate | front door / routing | — | safe-auto | free | S |
| claim.authenticate | OAuth / email identity + verified email | verified email | consent | free | S |
| claim.silent_precheck | zero-friction ownership score | — | safe-auto | free | S |
| claim.challenge | one explained OTP (+contact verify) | verified channel | consent | free | S |
| claim.verify_ownership | T2 proof (GBP match / re-lookup) | ownership evidence | consent→review | free | S,O |
| claim.disambiguate_self | pick among your own profiles | — | consent | free | S |
| claim.create_new | create-new w/ **confirmed** lookup | owner_verified h0 | consent+review | free | S |
| claim.delegate | agency/assistant on-behalf | delegated binding | consent+notify | free | S,O |
| claim.resolve_conflict | already-claimed / dispute | — | human-review | free | S,O |
| claim.grant | bind account↔entity at tier | owner_verified | consent | free | S |
| claim.release | unclaim (keep graph) | (open decision) | consent | free | O |
| interview.reset | reset journey (keep graph) | — | safe-auto | free | O |
| claim.verify_email | ensure verified email early | verified email | consent | free | S,O |
| extract.{category} | category-specialized extraction | inherits | safe-auto | free/metered | S,A |

---

## 8. Open Decisions (owed before/with build)

1. **Skill granularity** — keep `conflict.resolve` as one skill vs. split by field (address/phone/hours). Recommendation: one skill, field-parameterized; refactor once if needed.
2. **Interview: scripted vs. planner-generated** — ship scripted (deterministic, demo-faithful, safe); evolve toward planner-generated after the registry/kernel are proven.
3. **Compliance taxonomy** — the `restricted(vertical)` rules for mortgage/insurance/real-estate need legal input; the slots exist here, the policy content does not.
4. **Metering/pricing of `maprank.pull` / `citation.pull`** — cadence tiers and cost pass-through need finance input; these are the margin-sensitive skills at 40M scale.
5. **Autonomy gate** — hard line: no `autonomous`-mode execution of `consent-gated`/`restricted` skills until the governance envelope + proof loop exist. Scripted + suggestion-only first.

---

## 9. Build Phases — NORA OS Surface

Dependency-ordered. The north star: **Phase 4 (the scripted interview running through the registry on real data) is the acceptance test for the OS.** Everything before it builds the machine; everything after it is the same machine in autonomous mode.

**Phase 0 — Contracts & freeze (this document).**
Freeze the Skill Descriptor schema (§5.7.1), the World-Model object schemas (§5.8), and the event/attribution bus contract. Deliverable: the fleet can build tools to stable seams; NORA OS can build skills against stable state. *Exit:* schemas published, versioned, reviewed.

**Phase 1 — Kernel + Registry (walking skeleton).**
Minimal kernel that loads descriptors and runs an ordered scripted sequence; registry with register / discover / version; governance envelope stub; event bus. *Exit:* a 3-skill stub sequence runs end-to-end through the registry with events emitted.

**Phase 2 — World-model objects.**
Provenance envelope on the graph; Ledger data layer; snapshot store (with history); `contact_policy`; `goal`; `journey`/`trust_tier`. (Several are shared-foundation — coordinate ownership with the graph team.) *Exit:* every object readable/writable through the kernel with provenance + history.

**Phase 3 — The Claim Gate.**
Implement the claim skills (§5.2): `authenticate`, `silent_precheck` (GBP-match + domain/social scoring), `challenge` (OTP + fallback), `verify_ownership` (GBP primary + re-lookup), `create_new` (confirmed lookup), `delegate`, `resolve_conflict`, `grant`, `release`, `verify_email`. Instrument every step as its own funnel stage; set the silent-pass bar and start tuning. *Exit:* real users claim across G-COLD / G-CLAIM / G-RETURN at target pass-through; competitor/imposter attempts blocked before T2.

**Phase 4 — The scripted interview (ACCEPTANCE TEST).**
Register the generic skills (sourcing, reconciliation, graph/scoring, competitive, planning); build the interview **spine** template + **one** category module (loan officer). Run it end-to-end on real data through the kernel. *Exit:* a real profile goes claim → organized graph → conflicts resolved → competitive snapshot → plan (Ledger) → work agreement, entirely via registered skills. **This is "NORA OS v1 works."**

**Phase 5 — Category templates at scale.**
Template engine + per-category-group templates with overrides; the heavy extraction family (`extract.menu`, `extract.listings`, `extract.products`, …). *Exit:* interview runs correctly across the top category groups, menu-grade extraction included.

**Phase 6 — The perpetual loop.**
Autonomous kernel mode; planner selecting next-best from the Ledger against the goal; `communicate`/campaign skills gated by `contact_policy`. Suggestion-only first. *Exit:* NORA proposes and (for `safe-autonomous` only) executes standing work between sessions.

**Phase 7 — Governance, proof & monetization.**
Harden the compliance envelope (incl. `restricted(vertical)` rules); wire the attribution loop (action → metric delta → report); turn on the monetization bridge (paid-unlock pitches in the Ledger); open the autonomy gate for safe lanes only. *Exit:* NORA proves lift, surfaces honest paid pitches, and acts unattended within the safe boundary.

**Phase 8 — Interfaces.**
Persistent "Ask NORA" chat; the proof/report surface (the retention engine); the Nora OS run monitor. *Exit:* owners see value accrue without doing the work — the "can't afford to cancel" surface.

**Parallelization note (40-dev fleet):** Phase 0 unblocks everyone. Tools (engine layer) can be built by surface teams in parallel behind their signatures throughout. The critical path that must stay with NORA OS core is Phases 1 → 4.

---

*End v0.2. Build order follows §9. The interview is a strict subset of the perpetual loop — pass Phase 4 and ~90% of NORA's capability surface exists.*
