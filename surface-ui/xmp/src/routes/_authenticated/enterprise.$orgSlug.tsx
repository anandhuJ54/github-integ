import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/enterprise/$orgSlug")({
  component: () => <Outlet />,
});
