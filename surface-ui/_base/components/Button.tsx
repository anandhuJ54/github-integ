import type { ButtonHTMLAttributes } from "react";

// Placeholder primitive — proves the shared-UI import path. Replace with the real
// shadcn/Radix + Tailwind design system. Lives here once; used by every Surface.
export function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} />;
}
