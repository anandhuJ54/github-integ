# Pre-migration conflicts

Files that were untracked in v3-experiencesrp before the migration and whose content differed from
experiencesrp-clone@e9e96ce. The source copy now sits at the original path; the previous copy is kept here.

Provenance note: the 9 docs below were restored from `experiencesrp-v3/docs/` (the folder the untracked copy was
taken from — its tools/ and reference/ match the untracked copy exactly). The in-place untracked copies were
overwritten during staging before they could be moved, so a byte-for-byte match with them cannot be proven.

| File | Lines differing from source |
|---|---|
| docs/ETL-Enhancements.md | 477 |
| docs/ETL-Station6-to-Publish-Rollout-Plan.md | 32 |
| docs/Listings_Scope_Decisions.md | 4 |
| docs/NORA_OS_MASTER_BUILD_THREAD.md | 2 |
| docs/PLATFORM_STATE_2026-07-08.md | 4 |
| docs/Score_Architecture_Spec.md | 2 |
| docs/Score_Lanes_Complete_Spec.md | 2 |
| docs/Score_Reviews_Formula_Spec.md | 2 |
| docs/Score_Reviews_Logic.md | 2 |

The whole pre-existing `tools/` folder (including its 6 files that differed from source) was renamed to
`cur-tools/`, kept local and uncommitted by decision; `tools/` now holds the source copy.
