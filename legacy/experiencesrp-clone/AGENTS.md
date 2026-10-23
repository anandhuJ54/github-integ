<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- The existing `/sales/opportunities/$oppId` route is the sole CRM opportunity workspace; extend its focused workspace component instead of adding parallel pipeline or opportunity surfaces, so sellers have one governed lifecycle entry.
- Opportunity workspace interactions write to the existing CRM records and append an audit entry; lifecycle stage and close actions remain behind the governed database functions.
- Opportunity stage moves record the acting signed-in user and their role (admin, manager, seller) via a shared actor resolver; never assume the actor is a sales-rep row, because managers and admins move deals too.
- Alerts run in three tiers: database triggers for event rules, a short reminder sweep for due tasks, and a daily sweep only for absence rules, so event alerts are never delayed by a schedule.
- Logo engagement and whitespace use the shared pure rollup in `logo-intelligence.ts`; the opportunity workspace and SRE-derived views must not implement divergent metric definitions.
- The CPQ catalog (prices, packages, inclusions, pricing assumptions) is built at runtime from exp_products, exp_price_book and exp_pricing_config by `loadCatalog()`; code holds formulas only, so pricing changes never need a deploy.
- Catalog admin lives in the price-book route (Products, Prices, Volume tiers, Assumptions); it writes exp_products / exp_price_book / exp_pricing_config only, so the quote builder never needs code changes for catalog edits.
- `exp_price_tiers` is deprecated; the only volume schedule is `exp_pricing_config.volume_tiers`, and contract pages never edit prices — pricing changes only through the quote builder so one engine governs every number.
- Sales visual updates use shared Growth Hub tokens and a scoped inline-style generator; this keeps requested surfaces consistent without changing shared console behavior.
- Contract PDF exports use an authenticated non-nested print leaf and browser printing; document snapshots and signature audit records remain read-only, with unavailable evidence explicitly unrecorded.
- The Build module (`/build/*`) reuses the dev-progress surfaces (Overview, Launch/Priority boards, Weekly) by importing their exported components, and keeps wiki data access in `src/lib/build-wiki.ts`, so dev progress stays one implementation.
