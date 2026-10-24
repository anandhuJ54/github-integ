import { createFileRoute, redirect } from "@tanstack/react-router";

// The registry console moved to the skills Surface (surface audit 2026-10-24); the discovery
// pipeline health and ETL run monitor moved to /discovery (Pipeline Health tab).
export const Route = createFileRoute("/_authenticated/nora-os")({
  beforeLoad: () => {
    throw redirect({ to: "/skills", replace: true });
  },
});
