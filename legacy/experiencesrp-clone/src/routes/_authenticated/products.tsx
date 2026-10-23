import { createFileRoute, redirect } from "@tanstack/react-router";

// Retired: the price-book admin is the single catalog surface.
export const Route = createFileRoute("/_authenticated/products")({
  beforeLoad: () => {
    throw redirect({ to: "/sales/price-book", replace: true });
  },
});
