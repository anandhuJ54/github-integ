// Client shim: the server implementation moved to FastAPI (surface-api/srp).
// Each export keeps the createServerFn call shape: fn({ data }) -> Promise<result>.
import { serverFn } from "@v3/ui/lib/server-fn";

type ComplianceIssue = {
  rule_name: string;
  severity: string;
  rule_type: string;
  rule_value: string;
};

export const draftReviewReply = serverFn("srp", "draftReviewReply");
export const checkReplyCompliance = serverFn("srp", "checkReplyCompliance");
export const saveReviewReply = serverFn("srp", "saveReviewReply");
export const flagReview = serverFn("srp", "flagReview");
