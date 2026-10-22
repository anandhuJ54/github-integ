# Add NORA OS documents to the repo (GitHub)

## Goal
Commit the three NORA OS documents uploaded in this chat into the project so they land in the
GitHub repository via the existing two-way Git sync.

## What gets added
Copies of the uploaded files, placed where the documents themselves reference them:

| Source (upload) | Destination in repo |
|---|---|
| `NORA_OS_BUILD_HANDOFF.md` | `docs/NORA_OS_BUILD_HANDOFF.md` |
| `NORA_OS_ENGINEERING_DIRECTIVE.md` | `docs/NORA_OS_ENGINEERING_DIRECTIVE.md` |
| `nora-os-skills-registry.md` | `docs/nora-os-skills-registry.md` |

The handoff's own "read first" list references `docs/NORA_OS_ENGINEERING_DIRECTIVE.md` and
`docs/nora-os-skills-registry.md`, so those two paths are fixed. The handoff itself goes to
`docs/` alongside them.

## Steps
1. Copy the three files from the upload mount into `docs/` (no content edits).
2. Verify they are present and readable (line counts match the uploads).
3. No code, database, or app changes — documents only. tsgo not needed (no code touched).

## Notes
- Git sync is configured for this project (the Lovable-managed git remote is present), so
  these files sync to the connected GitHub repository automatically once committed. If
  GitHub sync is not actually connected for the workspace (check the + menu → GitHub), the
  files still land in the Lovable repository but will not appear on GitHub until it's
  connected.
- These are new files; nothing existing is overwritten.
