# Reference data (permanent fixtures)

## schemaorg-current.jsonld
Official schema.org vocabulary, release 29.2, pulled 2026-07-05 from
github.com/schemaorg/schemaorg (data/releases/29.2/schemaorg-current-https.jsonld).
920 classes, 1,507 properties (includes pending/attic sections).
USE THIS for all schema-validity checks — never recall schema.org from memory.
Query example: load @graph, filter @id == 'schema:TypeName'.
Verified on import: Corporation, tickerSymbol, Brand, InteractionCounter,
parentOrganization, memberOf, hasCredential, sameAs, potentialAction, seeks, Demand
all PRESENT; 'Franchise' ABSENT (do not use — model franchises via brand + memberOf).
