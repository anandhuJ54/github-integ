import { Sparkles } from "lucide-react";
import { cn } from "@v3/shared/components/utils/utils";
import type { ReactNode } from "react";

/** Pill with shimmering Gemini-ribbon border. */
export function AiBadge({
  children,
  className,
  icon = true,
}: {
  children: ReactNode;
  className?: string;
  icon?: boolean;
}) {
  return (
    <span
      className={cn(
        "relative inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-ink",
        className,
      )}
      style={{
        background: "#fff",
        backgroundClip: "padding-box",
        border: "1px solid transparent",
        backgroundImage:
          "linear-gradient(#fff,#fff), var(--gradient-gemini-ribbon)",
        backgroundOrigin: "border-box",
        backgroundSize: "100% 100%, 200% 100%",
        animation: "gemini-drift 6s linear infinite",
      }}
    >
      {icon && (
        <Sparkles
          className="h-3.5 w-3.5"
          style={{ color: "#4285f4" }}
        />
      )}
      {children}
    </span>
  );
}

/** Big gradient pill — primary CTA. */
export function GradientButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        "group relative inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white shadow-md transition-all hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0",
        className,
      )}
      style={{
        background: "var(--gradient-gemini)",
        backgroundSize: "200% 200%",
        animation: "gemini-drift 8s ease infinite",
      }}
    >
      {children}
    </button>
  );
}
