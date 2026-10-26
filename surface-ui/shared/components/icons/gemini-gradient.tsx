import { cn } from "@v3/shared/components/utils/utils";

/** Animated Gemini ribbon background (blue → purple → red → yellow). */
export function GeminiGradient({
  className,
  soft = false,
}: {
  className?: string;
  soft?: boolean;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0",
        soft ? "opacity-40" : "opacity-100",
        className,
      )}
      style={{
        background: soft ? "var(--gradient-gemini-soft)" : "var(--gradient-gemini)",
        backgroundSize: "200% 200%",
        animation: "gemini-drift 12s ease infinite",
      }}
    />
  );
}

/** Drifting blurred colored orbs — for hero backgrounds. */
export function OrbField({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <span
        className="absolute -top-24 -left-24 h-96 w-96 rounded-full blur-3xl opacity-60"
        style={{ background: "#4285f4", animation: "orb-float 18s ease-in-out infinite" }}
      />
      <span
        className="absolute top-1/3 right-0 h-80 w-80 rounded-full blur-3xl opacity-50"
        style={{ background: "#ea4335", animation: "orb-float 22s ease-in-out infinite reverse" }}
      />
      <span
        className="absolute bottom-0 left-1/3 h-96 w-96 rounded-full blur-3xl opacity-50"
        style={{ background: "#fbbc04", animation: "orb-float 26s ease-in-out infinite" }}
      />
      <span
        className="absolute -bottom-24 -right-24 h-80 w-80 rounded-full blur-3xl opacity-50"
        style={{ background: "#34a853", animation: "orb-float 20s ease-in-out infinite reverse" }}
      />
    </div>
  );
}

/** A thin animated rainbow ribbon — perfect for section dividers & top bars. */
export function GeminiRibbon({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("h-[2px] w-full", className)}
      style={{
        background: "var(--gradient-gemini-ribbon)",
        backgroundSize: "200% 100%",
        animation: "gemini-drift 8s linear infinite",
      }}
    />
  );
}
