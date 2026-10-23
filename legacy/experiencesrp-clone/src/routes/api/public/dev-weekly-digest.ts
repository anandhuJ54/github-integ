import { createFileRoute } from "@tanstack/react-router";

/**
 * DIGEST job. Compiles submitted updates + team progress and emails all members.
 * Called by pg_cron (via pg_net) with the x-cron-secret header.
 * GET returns the compiled text without sending, for preview/debugging.
 */
export const Route = createFileRoute("/api/public/dev-weekly-digest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const mod = await import("@/lib/dev-weekly.server");
        if (!mod.authorized(request)) return new Response("Unauthorized", { status: 401 });

        const weekStart = mod.weekStartIso();
        const ctx = await mod.loadWeeklyContext(weekStart);
        const from = mod.fromAddress(ctx.config);

        const lines: string[] = [`SRP Alpha weekly report — week of ${weekStart}`];
        if (ctx.launch) {
          const days = Math.round(
            (new Date(`${String(ctx.launch["launch_date"])}T00:00:00Z`).getTime() - Date.now()) /
              86_400_000,
          );
          lines.push(
            `${days} days to the ${String(ctx.launch["phase"])} launch on ${String(ctx.launch["launch_date"])}.`,
          );
        }

        const submittedIds = new Set(
          ctx.updates.filter((u) => u["status"] === "submitted").map((u) => String(u["member_id"])),
        );
        lines.push(`${submittedIds.size} of ${ctx.members.length} members submitted an update.`, "");

        for (const team of ctx.teams) {
          const teamId = String(team["id"]);
          const members = ctx.members.filter((m) => String(m["team_id"]) === teamId);
          if (!members.length) continue;
          const progress = mod.teamProgress(ctx.projects.filter((p) => String(p["team_id"]) === teamId));
          const teamSubmitted = members.filter((m) => submittedIds.has(String(m["id"]))).length;
          lines.push(
            `## ${String(team["name"])} — ${progress === null ? "no projects" : `${progress}%`} · ${teamSubmitted}/${members.length} submitted`,
          );
          for (const m of members) {
            const u = ctx.updates.find(
              (x) => String(x["member_id"]) === String(m["id"]) && x["status"] === "submitted",
            );
            if (!u) continue;
            lines.push(
              `- ${String(m["name"])} (${String(m["role"])})${
                u["self_progress_pct"] === null ? "" : ` — self ${String(u["self_progress_pct"])}%`
              }`,
            );
            if (u["highlights"]) lines.push(`  Highlights: ${String(u["highlights"])}`);
            if (u["blockers"]) lines.push(`  Blockers: ${String(u["blockers"])}`);
            if (u["next_week"]) lines.push(`  Next week: ${String(u["next_week"])}`);
          }
          const chase = members
            .filter((m) => !submittedIds.has(String(m["id"])))
            .map((m) => String(m["name"]));
          if (chase.length) lines.push(`  Awaiting: ${chase.join(", ")}`);
          lines.push("");
        }

        const text = lines.join("\n").trim();
        const to = ctx.members
          .map((m) => String(m["email"] ?? "").trim())
          .filter((e) => e.includes("@"));

        const result = await mod.sendMail({
          to,
          from,
          subject: `SRP Alpha weekly report — week of ${weekStart}`,
          text,
        });

        return Response.json({ job: "digest", week_start: weekStart, ...result });
      },
    },
  },
});
