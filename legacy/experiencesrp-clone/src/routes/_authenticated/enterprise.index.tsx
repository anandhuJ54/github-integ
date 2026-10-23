import { createFileRoute, redirect } from "@tanstack/react-router";
import { DEFAULT_BRAND_SLUG } from "@/lib/enterprise-xmp";

export const Route = createFileRoute("/_authenticated/enterprise/")({
  beforeLoad: () => {
    throw redirect({ to: "/enterprise/$orgSlug", params: { orgSlug: DEFAULT_BRAND_SLUG } });
  },
});
