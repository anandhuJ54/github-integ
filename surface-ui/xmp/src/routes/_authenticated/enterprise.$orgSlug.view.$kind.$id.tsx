/**
 * Legacy view-as URL. The deep role-shells now live at /seat/$kind/$id,
 * so this route just forwards while preserving the enterprise return path.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/enterprise/$orgSlug/view/$kind/$id")({
  ssr: false,
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/seat/$kind/$id",
      params: { kind: params.kind, id: params.id },
      search: { from: params.orgSlug },
    });
  },
});
