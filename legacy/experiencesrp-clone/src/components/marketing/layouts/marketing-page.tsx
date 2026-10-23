import type { ReactNode } from "react";
import { GlobalFinalCTA } from "@/components/marketing/sections/shared/GlobalFinalCTA";
import { SiteFooter, SiteHeader } from "@/components/public/site-chrome";

/**
 * Shared shell for the imported marketing pages.
 *
 * `mkt-scope` re-declares the marketing design-system variables (see src/styles.css)
 * so these pages keep their original palette without touching the console theme.
 */
export function MarketingPage({
  children,
  showFinalCTA = true,
}: {
  children: ReactNode;
  showFinalCTA?: boolean;
}) {
  return (
    <div className="mkt-scope flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="flex-1">
        {children}
        {showFinalCTA && <GlobalFinalCTA />}
      </main>
      <SiteFooter />
    </div>
  );
}
