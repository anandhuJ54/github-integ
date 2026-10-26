import type { AnchorHTMLAttributes, ReactNode } from "react";

type MarketingLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  to: string;
  children?: ReactNode;
};

/**
 * Marketing pages were authored against a different router. They only ever link to
 * plain paths (or absolute experience.com URLs), so a semantic anchor keeps the
 * markup crawlable and avoids coupling the marketing tree to typed app routes.
 */
export function Link({ to, children, ...rest }: MarketingLinkProps) {
  return (
    <a href={to} {...rest}>
      {children}
    </a>
  );
}

export default Link;
