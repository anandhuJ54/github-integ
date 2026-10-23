import type { ParityCase } from "./types";

// On GCP the three graph_nodes counts (3M rows, RLS per row) exceed the 8s statement_timeout of
// the `authenticated` role, so the legacy browser read fails outright; the API counts them in one
// scan on its own connection. Those three values are checked against SQL instead (see
// docs/BROWSER_TO_API_TODO.md, nora-os step 7).
const timedOutNodeCount = (type: string) => ({
  find: `count("graph_nodes", (q) => q.eq("source", "etl").eq("node_type", "${type}"))`,
  replace: "Promise.resolve(-1)",
  why: `graph_nodes ${type} count times out (8s) for the authenticated role`,
});

export const cases: ParityCase[] = [
  {
    name: "ETL run monitor",
    legacyModule: "surface-ui/nora-os/src/lib/etl-monitor.ts",
    legacyExport: "loadEtlMonitor",
    api: { method: "GET", path: "/nora-os/etl-monitor" },
    legacyPatch: ["product_service", "social_profile", "credential"].map(timedOutNodeCount),
    ignore: ["$.yield.nodes"],
  },
];
