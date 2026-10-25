// Client shim: the server implementation moved to FastAPI (surface-api/etl).
// Each export keeps the createServerFn call shape: fn({ data }) -> Promise<result>.
import { serverFn } from "@v3/ui/lib/server-fn";

/* G2 (contract review, 2026-10-13): "Preview records" for a pending site-map proposal.
   Builds records exactly as the harvest would stage them (same exported builders as the harvest workers:
   applySiteContract, applyAddressOwner, applyExtraFields, buildHarvestRecord). Read-only: nothing is
   written. Not included: the category's generic taxonomy routes the harvest adds at run time (they only
   fill values that are still empty). Admins only (super_admin / architect).
   Contract re-check (2026-10-15): the same preview also runs on the SAVED contract ({ domain, gcid } instead of
   proposalId), on the contract's sample pages or on up to 10 URLs given by the reviewer. A given URL must be on
   the site and match the contract's profile page pattern, otherwise it is listed with the reason and not fetched.
   A contract whose detail route reads the site's profile API (record_source 'api' / 'api+page') is previewed the
   way disco-detail-api-worker harvests it: JSON values first, the page fills the rest (or is the fallback). */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type ProposalPreviewRecord = {
  url: string;
  ok: boolean;
  reason?: string;
  entity_type?: string;
  filled?: number;
  floor_needed?: number;
  shallow?: boolean;
  must_have?: { ok: boolean; missing: string[] };
  universal?: Record<string, any>;
  /** Full record as staging would store it (taxonomy values, _subjects, _extra, _static_sources). */
  payload?: Record<string, any>;
  identity?: Record<string, any>;
  /** Where the values came from: page, api, api+page, or page_fallback (API did not answer). */
  detail_source?: string;
};

export const previewSiteProposal = serverFn<{ domain: string; target: string; records: ProposalPreviewRecord[] }>("etl", "previewSiteProposal");
export const acceptSiteProposal = serverFn<Record<string, any>>("etl", "acceptSiteProposal");
