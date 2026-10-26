# Expertise Engine

You are building Experience.com — an AI-powered Search Rank Platform. 

This is NOT a simple directory or listings tool. It is a sophisticated three-platform system:

1. SRP (Search Rank Platform) — public-facing profiles, expertise graph, search rank score, products, public pages
2. XMP (Experience Management Platform) — enterprise layer, hierarchy, brand governance, 1-to-many management  
3. EMP (Experience Management Platform internal) — internal ops, claims, sales, support, index intelligence

THE CORE CONCEPT:
Every professional and location business has an "expertise graph" — a living knowledge object organized in 8 rings that represents their complete digital authority. The graph generates perfect schema.org markup, powers a Search Rank Score out of 850 points, and drives AI search visibility.

THE ARCHITECTURE IS CATEGORY-OUT:
The platform is built around Google Business Profile categories (4,041 of them). Every vertical inherits from a category knowledge model. A new vertical = configuration, not code. Everything from scoring weights to compliance rules to directory listings to AI agent vocabulary is determined by category.

NAMING CONVENTIONS (use these exactly, everywhere):
- Platform: Experience.com
- App domain: experience.app  
- Search Rank Score (SRS) — the 850-point score
- Expertise Graph — the 8-ring knowledge object
- Vertical Node Registry — the directory/platform map per category
- Taxonomy Stack — profession titles → specializations → products → topics → tags → keywords → questions
- GBP — Google Business Profile
- gcid — Google category identifier (e.g. gcid:mortgage_broker)
- ETL Engine — the always-on profile builder
- PLG — product-led growth (the rules engine that drives upgrades)
- SRP, XMP, EMP — the three sub-platforms

THE THREE ENTITY TYPES:
1. Professional (Person) — individual practitioner, has their own profile, credentials, graph
2. Organization — brand, firm, franchise, office, location — has its own profile and hierarchy
3. Both — some categories have both (e.g. a mortgage broker is a person AND has an office)

KEY RULES:
- Graph and schema are ONE design decision — every graph node maps to a schema.org type
- Compliance is enforced at the data layer — every category has compliance rules
- Every entity has a stable @id (canonical URL), sameAs array, and schema_type
- The Search Rank Score is the product — gaps in the score drive every upgrade prompt
- Free users get the graph built — paid users get full depth and AI agent layer

TECH STACK:
- Frontend: React + Tailwind
- Backend: Supabase (Postgres + Auth + Storage + Edge Functions)
- AI: Anthropic Claude API (claude-sonnet-4-6)
- Payments: Stripe
- Schema output: JSON-LD in page head

DO NOT BUILD ANYTHING YET. 

Just confirm you understand this project by responding with:
1. A one-paragraph summary of what Experience.com is
2. The three sub-platforms and what each does
3. The eight rings of the expertise graph
4. What "category-out" means in your own words

We will build this step by step. Every prompt will be precise. Do not add features, do not make assumptions, do not build ahead. Confirm understanding only.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://experiencesrp.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/f3a72aef-0294-4fdf-bcad-77257ed344ef).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
