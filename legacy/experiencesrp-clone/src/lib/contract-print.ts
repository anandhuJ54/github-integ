import type { ContractDetail } from "./contracts";

export type PrintDoc = "order_form" | "certificate";
export const printDoc = (doc: unknown): PrintDoc => doc === "certificate" ? "certificate" : "order_form";
export const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const records = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(record) : [];
export const text = (value: unknown): string => value == null || value === "" ? "—" : typeof value === "object" ? "—" : String(value);
export function utc(value: unknown): string {
  if (typeof value !== "string" || !value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}
export const verification = (value: unknown): string => value === true ? "Yes" : value === false ? "No" : "Not recorded";
export const hasCertificate = (D: Pick<ContractDetail, "contract" | "documents">): boolean => Boolean(D.contract.executed_at || D.documents.some(d => d.doc_type === "certificate"));