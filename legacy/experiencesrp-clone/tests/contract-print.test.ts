import { describe, expect, it } from "bun:test";
import { hasCertificate, printDoc, utc, verification } from "../src/lib/contract-print";
import type { ContractDetail } from "../src/lib/contracts";

describe("contract print export rules", () => {
  it("defaults to the order form and accepts certificate selection", () => {
    expect(printDoc(undefined)).toBe("order_form");
    expect(printDoc("other")).toBe("order_form");
    expect(printDoc("certificate")).toBe("certificate");
  });
  it("permits certificates only with recorded execution or a certificate document", () => {
    const D = { contract: { executed_at: null, status: "active" }, documents: [] } as unknown as ContractDetail;
    expect(hasCertificate(D)).toBe(false);
    D.contract.executed_at = "2026-10-06T19:58:00Z";
    expect(hasCertificate(D)).toBe(true);
    D.contract.executed_at = null;
    D.documents = [{ doc_type: "certificate" }] as ContractDetail["documents"];
    expect(hasCertificate(D)).toBe(true);
  });
  it("converts signing timestamps to UTC without inventing missing dates", () => {
    expect(utc("2026-10-06T15:58:00-04:00")).toBe("2026-10-06 19:58:00 UTC");
    expect(utc(null)).toBe("Not recorded");
    expect(utc("invalid")).toBe("Not recorded");
  });
  it("does not infer verified email from an identity method", () => {
    expect(verification(undefined)).toBe("Not recorded");
    expect(verification("email_otp")).toBe("Not recorded");
    expect(verification(true)).toBe("Yes");
    expect(verification(false)).toBe("No");
  });
});