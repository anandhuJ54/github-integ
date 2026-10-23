import { createFileRoute } from "@tanstack/react-router";

/** Public, non-sensitive: tells the console whether outbound email is configured. */
export const Route = createFileRoute("/api/public/dev-weekly-status")({
  server: {
    handlers: {
      GET: async () => {
        const { emailConfigured } = await import("@/lib/dev-weekly.server");
        return Response.json({
          emailConfigured: emailConfigured(),
          cronConfigured: !!process.env["DEV_REPORT_CRON_SECRET"],
        });
      },
    },
  },
});
