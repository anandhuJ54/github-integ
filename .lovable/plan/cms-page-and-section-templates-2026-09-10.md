# CMS Page and Section Templates

## Goal
Add a Templates area inside **Demand Engine → CMS**, using the same light table-and-drawer design as Site Content. Templates are created from existing CMS pages only and can be reused to create a new draft or update an existing page.

## User experience

### 1. Pages and Templates sections
- Add **Pages** and **Templates** tabs to the existing Site Content screen.
- Keep the current page list, filters, design tags, publishing controls, and editor unchanged under Pages.
- Add a Templates table showing template name, type (Whole page or Section), source page, section count, design tag, creator, and updated date.
- Include actions to use, rename, preview contents, or delete a template.

### 2. Create Template from a selected page
- When exactly one page checkbox is selected, show **Create template** with the existing bulk actions.
- Open a focused setup dialog with:
  - Template name
  - **Whole page** or **Specific sections**
  - Source-page summary
- Whole page snapshots the page’s current editable content and page settings.
- Specific sections shows the page’s ordered CMS sections as selectable cards. Each section gets a clear selection dot/checkbox and a content preview; multiple sections can be selected.
- Validate that the template has a name and, for section templates, at least one selected section.

### 3. Reuse templates
- **Create new draft:** ask for title and page type, generate a unique slug, and populate the draft from the saved template.
- **Apply to existing page:** choose a destination page and confirm before replacing its content with a whole-page template.
- Section templates can be appended to an existing page, or used as the starting content of a new draft.
- Copy saved JSON rather than referencing the source page, so templates remain stable if the source later changes.

### 4. Persistence and accountability
- Add a dedicated backend table for page and section templates, including source page, template kind, saved content, saved page settings, selected section indexes, creator, and timestamps.
- Keep templates private to signed-in console users; do not expose them publicly.
- Grant authenticated access, enable row-level security, and include required service access in the same migration.
- Record create, apply, rename, and delete actions in the existing audit log.

## Technical details
- Reuse the existing CMS `Block` format, `blocksOf()` normalization, page types, design tags, console tables, dialogs, and form controls.
- Add template loaders and mutations beside the existing website CMS data functions.
- Add a section-selection component that renders recognizable block summaries without changing the public page renderer.
- Applying a whole-page template copies editable CMS body/settings; applying a section template copies only selected blocks.
- Preserve the current route and public page behavior. No new public route is required.

## Verification
- Create a whole-page template from one selected page and confirm it appears in Templates after refresh.
- Create a multi-section template and confirm only selected sections were saved in order.
- Create a new draft from each template type and verify the saved page content round-trips from the backend.
- Apply a template to an existing test page after confirmation and verify the updated content.
- Verify templates are not publicly readable, existing page bulk actions still work, and the CMS remains usable at desktop and mobile widths.
