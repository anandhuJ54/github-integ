# Intent: Read/write database split (primary + read replica)

<!-- Stage: Define. Shared template — do not remove sections. Add Surface sections from template-additions.md. -->

| Field | Value |
|---|---|
| Surface | _base (shared core) |
| Increment id | _base/db-read-write-split |
| Status | draft |
| Date | 2026-10-23 |

## Problem
The shared data layer opens a brand-new connection to a single database on every call
(`psycopg.connect(DATABASE_URL)` per request) and routes every read and write to that one
node. There is no connection pooling and no way to send high-volume reads (profile reads,
listings, search) to a read replica while keeping writes on the primary. As read traffic
grows this makes the single primary the bottleneck and gives us no horizontal headroom.

## Outcome
Reads can be served from a read replica and writes always land on the primary, chosen
per operation at the call site, with connection pooling in front of both. A read that must
reflect a just-completed write (read-after-write) can opt back onto the primary. Behaviour
is unchanged when no replica is configured (dev / single-node falls back to the primary).

## Signals and sources
Every claim cites a source: live DB query, repo path:line, meeting note, ticket, Observe finding.
Label each as **Live**, **Repo**, **Programme input** or **Target**.

| Source | Label | What it shows |
|---|---|---|
| `surface-api/_base/core/db.py:17-27` | Repo | Single `DATABASE_URL`; a fresh `psycopg.connect` per call, no pool |
| `surface-api/_base/core/db.py:31-46` | Repo | `rls_connection` sets `request.jwt.claims`; same single URL for reads and writes |
| `surface-api/migrate.py:39,52`, `_base/core/compliance.py:30` | Repo | Current callers of `connection()` that must keep working |
| Horizontal read scalability without a primary bottleneck | Target | Why the split is wanted |

## Success measure
After rollout: profile-read endpoints issue their queries on the replica connection
(verified by routing/label, not row content), writes on the primary, and p95 read latency
and primary connection count do not regress under the same load. Confirmed in Observe via
connection-source metrics over a 1-week window.

## Open decisions touched
List any O-numbers or unassigned-ownership items this depends on. **List, never resolve.**

- **O12 (security hardening)** — adds a second connection string / secret (`DATABASE_READ_URL`).
- **Shared-core ownership** — `_base/core/db.py` is shared runtime (root AGENTS.md §2);
  this change needs a PR reviewed for all Surfaces, not SRP alone. Unassigned shared-runtime
  ownership is an open item.

## Out of scope
- Multiple read replicas / replica load-balancing (single replica URL only here).
- Changing the write boundary itself (writes stay governed functions + RLS; no raw
  INSERT/UPDATE on `exp_*`/`graph_*`/`search_*`).
- Automatic read-after-write detection (caller opts in explicitly via `fresh=True`).
