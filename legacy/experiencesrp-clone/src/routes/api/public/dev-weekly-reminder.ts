import { createFileRoute } from "@tanstack/react-router";

/**
 * REMINDER job. Emails every member who is still 'pending' for the current week.
 * Called by pg_cron (via pg_net) with the x-cron-secret header.
 */
export const Route = createFileRoute("/api/public/dev-weekly-reminder")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const mod = await import("@/lib/dev-weekly.server");
        if (!mod.authorized(request)) return new Response("Unauthorized", { status: 401 });

        const weekStart = mod.weekStartIso();
        const ctx = await mod.loadWeeklyContext(weekStart);
        const from = mod.fromAddress(ctx.config);

        const submitted = new Set(
          ctx.updates.filter((u) => u["status"] === "submitted").map((u) => String(u["member_id"])),
        );
        const pending = ctx.members.filter((m) => !submitted.has(String(m["id"])));
        const to = pending
          .map((m) => String(m["email"] ?? "").trim())
          .filter((e) => e.includes("@"));

        const dueLabel = `${ctx.config?.["due_day"] ?? "Friday"} ${ctx.config?.["due_time"] ?? "09:00"}`;
        const text = [
          `Your SRP Alpha weekly update for the week of ${weekStart} is still outstanding.`,
          `It is due ${dueLabel}.`,
          "",
          "Open SRP Dev Progress → Weekly and fill in: self progress %, highlights, blockers, next week.",
        ].join("\n");

        const result = await mod.sendMail({
          to,
          from,
          subject: `Weekly update due — week of ${weekStart}`,
          text,
        });

        return Response.json({
          job: "reminder",
          week_start: weekStart,
          pending: pending.length,
          ...result,
        });
      },
    },
  },
});
