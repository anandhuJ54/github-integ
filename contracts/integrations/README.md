# Contracts — Surface 14 (Integrations)

- `openapi.json` — this Surface's published API shapes (`cd surface-api && uv run python -m app.contracts integrations`).
- `events/` — JSON Schema per event, file name `<event.type>.v<N>.json`. Envelope: `id, type, schema_version, owner, aggregate_id, aggregate_version, occurred_at, actor, causation_id, correlation_id, payload`.
- `capabilities/` — OpenAPI (or JSON Schema) per capability: typed I/O, idempotency key, dry-run, side effects, entitlement, errors.

Breaking changes need a new version and approval from consuming Surfaces.
