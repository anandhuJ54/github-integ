import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const questionSchema = z.object({ question: z.string().trim().min(2).max(300) });

export const Route = createFileRoute("/api/search-assistant")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = questionSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json({ error: "Please enter a question." }, { status: 400 });
        }
        return Response.json({
          status: "coming_soon",
          message: "AI answers coming soon",
        });
      },
    },
  },
});