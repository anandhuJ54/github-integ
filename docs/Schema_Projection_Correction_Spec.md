# Schema Projection Correction Spec (for 10-ring regeneration of exp_category_schema)
Adjudicated 2026-07-05 from external assessment; every rule fixture-gated.

## Confirmed defects in the 149-field RE pilot (fix in regeneration)
1. worksFor: SOURCE must carry the Person facet (worksFor is Person-domain only; a bare
   RealEstateAgent root cannot emit it). TARGET is Organization or any Organization
   subtype — a RealEstateAgent-typed brokerage is valid by inheritance and preferred
   (more specific local signal); never a person-typed target.
2. License STATUS is a platform-only field — NO markup projection. additionalProperty is
   INVALID on EducationalOccupationalCredential (gate); validFrom/validUntil are dates only.
3. performTime is INVALID on Person and RealEstateAgent — career metrics never use it.
4. Career/T12 sales volume: never priceRange (customer price level) or offers.price.
   Metrics attach as additionalProperty(PropertyValue) ON THE RealEstateAgent FACET ONLY —
   additionalProperty is INVALID on Person (gate), valid on LocalBusiness via Place.
5. Every InteractionCounter carries interactionType (FollowAction/LikeAction/ShareAction/
   CommentAction/ViewAction) — no ambiguous bare userInteractionCount.
6. Ratings are source-specific AggregateRating objects w/ publisher provenance (@id) —
   reviewCount never overloaded across platforms. (Matches Reputation ring note.)
7. awards[] normalized internally; award/awards both valid outward.
8. License display label is JURISDICTION-driven (CA: DRE # / TX: TREC # / FL: SL-BK # /
   generic fallback) — state overlay on exp_category_compliance, not category-fixed.

## Standing principle
Fields ≠ markup: platform fields without a valid schema slot project NO markup rather
than a forced-invalid property. The gate applies to external reviewers' fixes too —
two of three proposed fixes here failed it.

9. Credential dates: license expiration = hasCredential.expires, first-licensed =
   hasCredential.dateCreated (EOC inherits CreativeWork). validFrom/validUntil are
   INVALID on EducationalOccupationalCredential — caught only by per-hop linting.

## Linter rule (structural)
Dotted property paths are linted AT EVERY HOP, not just the root — hasCredential on
RealEstateAgent passing says nothing about validUntil on the credential object.

10. credentialId does not exist in schema.org. License/credential numbers ride
    hasCredential.identifier (Thing.identifier). Caught by per-hop linting against
    our own exemplars — root-only linting had passed it.
