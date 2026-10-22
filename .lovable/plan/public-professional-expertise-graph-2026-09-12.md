# Public Professional Expertise Graph

## Scope
Enhance only the existing public professional profile at `/p/$slug` and its profile-specific data/components. Keep the category-configured renderer intact and make no database, scoring, graph, taxonomy, ETL, or marketing changes.

## What will change

### 1. Load the live proof graph with the professional profile
- Extend the existing professional bundle with the eight active `exp_ring` rows where `layer = 'proof'`, ordered by `sort`.
- Load only this professional’s active `graph_nodes` in the proof layer, including `ring_key`, `node_type`, `title`, `url`, `extracted_data`, `source`, and verification fields.
- Count nodes strictly by the stored `ring_key`; do not infer or remap rings.
- Load outgoing `graph_edges` where `edge_type = 'recommends'` and `from_entity_id` matches the professional, then resolve real target names from professionals or organizations.
- Keep all reads public and read-only. No writes, migrations, score calculations, or synthesized graph nodes.

### 2. Add an Experience Score panel
- Show all eight canonical proof rings in database order with their live node counts.
- Show a small completeness bar using a clearly presentational 10-node soft cap; the count remains the source of truth and no overall score is derived.
- Replace any numeric Search Rank display on `/p/$slug` with an explicit `Score pending` / `Computing` state, even when a placeholder zero exists in the profile row.
- Use `exp_ring.color` when populated. If a ring has no database color, render it neutrally rather than inventing a category color.

### 3. Add the public expertise graph visualization
- Create a light, mobile-first, profile-specific visualization with the professional as the central planet and the eight proof rings as concentric orbits.
- Place one deterministic dot per real node on its stored ring; dot density therefore reflects the real count.
- Include a ring legend showing each canonical display name, color, and live count.
- Keep the visualization stable and readable on narrow screens without changing the separate admin/dark graph page.

### 4. Render populated ring sections
- Group real nodes by `ring_key` and render only rings with at least one node.
- Use each node’s title, URL, and safe human-readable values from `extracted_data`.
- Make presence/profile nodes external links when a real URL exists.
- Show verification provenance on credential and verified nodes: verified source badges when verified, and a subtler self-reported state when unverified.
- Do not create empty identity, location, reputation, content, or media sections when those rings have no nodes.

### 5. Add Trusted Network and strengthen claiming
- Render real `recommends` relationships with target name, relationship type, and status.
- When no such rows exist, show `No verified partners yet`.
- Keep the existing category-aware subtitle and conversion system, while making the unclaimed profile action directly visible and dominant in the hero on mobile and desktop.
- Preserve insurance-specific language and avoid listing/MLS treatment for insurance profiles.

## Technical details
- Update `src/lib/profile-render.ts` with additive profile graph types and professional-only read loaders.
- Add a focused profile component for the score panel, orbital visualization, ring sections, provenance, and Trusted Network.
- Update `src/components/profile/category-profile.tsx` only to render the new profile graph content and the honest pending score state.
- Do not alter `src/lib/expertise-graph.ts`, the standalone graph routes, generated database types, or any database object.

## Verification
- Open the live State Farm insurance profile `sf-5e87f34a6785fb916dd0` on desktop and mobile.
- Confirm the page remains category-correct and the unclaimed claim action is visible in the hero.
- Confirm the Experience Score reads `Score pending`, never `0` or another numeric score.
- Confirm live counts render as Credentials 3, Services 9, and Presence 10 for the current data.
- Confirm the other five zero-node proof rings are absent from the ring-detail sections while all eight remain visible in the score panel/orbit legend.
- Confirm the visualization contains 22 real node dots and Trusted Network shows `No verified partners yet` because the live profile has no `recommends` edges.
- Check the page for browser errors, broken external links, overflow, and mobile overlap.
