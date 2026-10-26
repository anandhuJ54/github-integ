# NORA OS — Vision, Product, GTM & Business Model (the "what & why")

**Read this before the build docs.** The Engineering Directive and Master Build Thread say *how* to build; this says *what we're building and why it matters.* It captures the substance worked out across the planning conversation so no agent or teammate starts without the full picture. Companion to `docs/NORA_OS_ENGINEERING_DIRECTIVE.md` (how), `docs/nora-os-skills-registry.md` (the skill model), `docs/NORA_OS_MASTER_BUILD_THREAD.md` (state + queue). `CLAUDE.md` still wins on hard rules.

---

## 1. What NORA OS is
NORA is a **Digital Expertise OS** — an AI partner that lives on top of Experience.com's knowledge graph and works, continuously, to get a professional or business found and chosen. It understands an entity, its real expertise, its competitors, its current performance, the gaps, and the actions that close them — and it executes or pitches those actions. The platform is built **category-out** over Google's 4,041 Business Profile categories; a new category is **configuration, not code**.

**The core operating loop (everything serves this):**
**OBSERVE → UNDERSTAND → EVALUATE → PRIORITIZE → ACT → VERIFY → LEARN.**

NORA has two modes off one engine:
- **The first-run interview** (the "cold open") — acquisition + the first wow.
- **The perpetual CoPilot** ("NORA the nag") — the real product, running forever toward one goal.

**The interview is a strict subset of the perpetual loop.** Build the interview to run end-to-end through the skills registry on real data and ~90% of NORA exists.

## 2. The product experience

### 2a. The first-run interview (from the "Nora's First Hello" demo)
When someone claims their profile, NORA runs a guided, mostly-no-typing interview:
1. **Claim + silent verification** — see §6 (the claim gate).
2. **Organize the internet** — confirms/scrapes the website + Google Business Profile, double-hops to other owned properties, runs a `[category] [name] [geo]` web sweep, and asks "tap the ones that are you." Everything upserts into one record as graph nodes/signals with provenance.
3. **Resolve conflicts** — multiple addresses/phones/hours → owner picks canonical; NORA also **catches the wrong person** (a different same-named professional) and walls them off.
4. **Products/services** — read off the site, confirmed in one tap.
5. **The Expertise Graph** — the organized record rendered as a radial graph; counts of nodes/signals/photos; the Search Rank Score (SRS).
6. **Find your target** — competitors who are beating them, via **Map Rank** (geo-grid rank, share-of-voice) and **LLM Citation** (does ChatGPT/Gemini/Claude/Perplexity name them); NORA anchors on **one** rival to beat.
7. **The winning plan** — a ranked gap list (graph vs. the winners), each item FIX/MISSING/STRONG, product-tied — this **is the Opportunity Ledger.**
8. **The work agreement** — when/how NORA may contact them (days, time, channels) + a persistent "Ask NORA" chat.

Even if the person never returns, the interview leaves behind a **user-verified, deduped, richly-organized profile** — that's the Experience.com-side payoff.

### 2b. The perpetual CoPilot ("the nag")
After the interview, NORA never stops. Its **goal function: get this entity to #1 in its category/geo and hold it.** It works the Ledger autonomously on the safe lanes, pitches the paid ones, measures lift, and reports — on the owner's agreed cadence. Key theses:
- **The Ledger is the paywall.** Each gap is NORA-does-it-free, NORA-does-it-if-you-pay, or you-must-do. Value and revenue are the *same* event — the pitch is the next-best action. Integrity rule: NORA only surfaces a paid action if it genuinely moves the number for *this* entity.
- **Retention = autonomous value + proof + a defended position.** Make the owner's effort < NORA's value so "can I afford to cancel?" The proof/attribution loop (action → rank/citation delta) is what sustains both retention and the upgrade ladder. Canceling isn't neutral — the position decays as other NORA+partner teams pass you.
- **Not zero-sum.** Search is high-dimensional (keyword × intent × neighborhood × product × expertise niche × engine), so many entities can each win different slices. The binding constraint on winning is the professional's own (under-expressed) expertise and effort — NORA expresses and amplifies it. "#1 and hold" at the head term is the exclusivity/zip tier; lower tiers honestly promise "climb and get found."

## 3. How it works (the model)
- **The graph:** `graph_nodes` + `graph_edges` in Postgres (not a graph DB). Every fact carries **provenance + trust tier** (`self_declared | imported | platform_observed | authority_verified`); the owner-verified claim write is the highest-value data event.
- **Rings + scoring:** each entity gets an expertise graph across the canonical rings (10 rings, canonical in `exp_rings`) that emits schema.org and powers the **Search Rank Score (SRS)**, an 850-point score with per-lane sub-scores.
- **Skills & tools (the registry):** **skills** = business capabilities = **value loops** (`exp_skill_registry`); **tools/capabilities** = executable ops (`exp_capability_registry`); versioned manifests (`exp_skill_version`); evals (`exp_skill_eval`); run log (`exp_skill_run`). The kernel runs skills; skills compose tools. Full spec: `docs/nora-os-skills-registry.md`.
- **Claim gate:** graduated trust (T0 authenticated → T1 identity+email → T2 ownership-proven), silent-first, with **Google Business Profile management match on the stored Place ID** as the instant, competitor-proof ownership path.
- **Category-out:** all intelligence is keyed to real GBP `gcid`s; the knowledge model + logic layer are complete across 4,041 categories; downstream structural layers are projected per category from that data — no per-category code.

## 4. The value loops (what NORA does for the user)
These are the `value_loop` groupings in the live registry — the user-facing jobs NORA runs: **Claim → first win · Organize the internet · Find your target · Make a plan · Work agreement · Activation · Improve Professional Profile · Reputation · Reviews velocity · Listings consistency · Content/VOCE · Referral/expansion · Ongoing partner.** Each loop is one or more registered skills; the interview chains the first several, the CoPilot runs them forever.

## 5. The category taxonomy
- **4,041 real Google Business Profile categories (`gcid`s)** are the spine. No invented categories (hard rule). A profession with no exact GBP category maps to the nearest real one or isn't seeded.
- **Config, not code:** a new category inherits its knowledge model (terminology, value props, search intents, conversion actions — complete across all 4,041), then gets its node registry / taxonomy / compliance / scoring / schema projected from that.
- **Compliance is per-category** (`content_compliance_rules` + `exp_category_compliance`): e.g. mortgage → RESPA/TILA (no rate guarantees, show NMLS ID); real estate → Fair Housing (no steering, brokerage in ads). Every AI/publish path passes the filter.

## 6. The claim gate (the conversion chokepoint)
Claim is graduated trust, silent-first: NORA verifies from signals already held before asking anything, challenges once (an explained OTP to an on-file channel) only when the silent check is short, and steps up (GBP match / domain email / live re-lookup) only for ambiguity. The majority path — Google OAuth + Place-ID management match — is one tap and competitor-proof. Easy to claim, easy to unclaim/reset, and a competitor can't take a profile because harmful actions sit behind T2 ownership proof. Full design in the skills-registry spec.

## 7. Go-to-market
**The motion:** scrape + index the whole population → rank those profiles so people find themselves when they Google their name → they **claim** → NORA interviews them and delivers instant value → they see growth → they upgrade → they buy Amplify, a zip code, conversion agents → they make more money and dominate search. NORA is the partner; tools unlock value.

**The organic funnel is the governor.** Today (≈6M indexed): ~10,000 claim attempts/mo → ~2,000 claims (20% workflow) → ~300 interviews (human-booked meetings, 15%). The two broken middle stages are what NORA automates — fix them and the same inputs yield ~100× the interviews. **Unit metric: every interview ≈ $108/yr recurring ARR** (12% convert × $900 avg). So the whole company reduces to **two dials: activation (how many of 40M go through a NORA experience) × partnership depth (how far up the ladder they climb).**

**Four scaled channels (funded as cash comes in):**
1. **Marketing agencies** — a partner program; agencies onboard their clients (requires the delegated-claim path). Highest velocity; watch retention/margin dilution.
2. **Influencers** — category-specific + a flagship partner. Ignition + trust within categories.
3. **Events** — keynote + booth at every event with 10K+ of our audience. Math: ~$200K for 30 min to 50K attendees needs ~200 upgrades to break even (0.4% of the room); the real yield is thousands of **seeded interviews** + legitimacy.
4. **Content marketing / AI GTM engine** — the compounding moat. 4,000 category websites with autonomous articles, Q&A, reviews, white papers, Google boosts, and per-category SDRCloud campaigns. It industrializes "eat your own cooking," manufactures interview throughput, and feeds sponsored inventory + BI + publish rights. Defensible *because* it's grounded in the verified expertise graph (not spun content — which is what algorithm updates kill).

## 8. The business model, TAM & SAM
**Inventory/scale:** 4,041 categories × ~40,000 zips = ~160M category-geo markets; ~**40M professional/business profiles** is the asset.

**Per-profile products (monthly):** Engage **$99** · Amplify **$129** · Conversion agents **$129** · Sponsored search **$99**. Fully loaded = **$456/mo = $5,472/yr**.

**TAM (100% of 40M):** ≈ **$219B/yr** from the per-profile stack (subscriptions ≈ $171B + sponsored, capped by 40M buyers at $99 ≈ $47.5B). Every 1 point of fully-loaded penetration ≈ **$2.2B/yr**.

**SAM ≈ TAM.** The usual reach gap is engineered to ~zero because we pre-build and pre-index 100% of profiles; public-only launch + monthly refresh = ~90–95% live, so SAM ≈ **~$204B/yr**. Since SAM ≈ TAM, the whole game is **SOM** — conversion and retention, not distribution.

**Conservative base case:** 12% of people who go through a NORA interview pay, at **$900/yr** average → at full activation of the 40M that is **$4.32B/yr** recurring; near-term it's `interviews × $108`. For scale: $100M ARR ≈ 925K interviews; ~$900M ARR ≈ 8.3M interviews.

**Not yet counted (all additive, on top):** **Enterprise** (org-level contracts across rosters — State Farm / NAF / RE/MAX motion), **BI tools** (selling aggregate graph intelligence), and **publish rights** (syndication/licensing of the verified graph to LLMs/search/partners).

## 9. Why it wins (the moat)
- **The verified Expertise Graph is the asset** — pre-built, user-verified, provenance-tracked, across 40M entities. Protect the data set accordingly (see Master Thread §4).
- **Only we can build the content/GTM engine** — VOCE + Experience.com + Brandiva + agentic dev + the graph is a combination no competitor has.
- **Claim is one-tap and competitor-proof** — we hold the GBP API access + the Place IDs for the whole universe, so the hardest conversion step is where we're strongest.
- **Expertise is abundant and under-expressed** — NORA grows the pie (expresses latent expertise) rather than dividing a fixed one, so everyone can win and the nag never runs out of honest work.

---
*This is the context pack. For the build: read `docs/NORA_OS_MASTER_BUILD_THREAD.md` (state + queue), `docs/NORA_OS_ENGINEERING_DIRECTIVE.md` (how), `docs/nora-os-skills-registry.md` (skill model). `CLAUDE.md` wins on conflict.*
