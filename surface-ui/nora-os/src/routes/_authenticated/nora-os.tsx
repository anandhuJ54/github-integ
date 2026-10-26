import { createFileRoute, redirect } from "@tanstack/react-router";

// The registry console moved to the skills Surface (surface audit 2026-10-24); the discovery
// pipeline health and ETL run monitor moved to /run-health. Both are under the NORA OS menu.
export const Route = createFileRoute("/_authenticated/nora-os")({
  beforeLoad: () => {
    throw redirect({ to: "/skills", replace: true });
  },
});
