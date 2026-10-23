import type { ParityCase } from "./types";

export const cases: ParityCase[] = [
  {
    name: "ETL run monitor",
    legacyModule: "surface-ui/nora-os/src/lib/etl-monitor.ts",
    legacyExport: "loadEtlMonitor",
    api: { method: "GET", path: "/nora-os/etl-monitor" },
  },
];
