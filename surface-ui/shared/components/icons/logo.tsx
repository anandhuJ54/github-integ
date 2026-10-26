import { cn } from "@v3/shared/components/utils/utils";

/**
 * Single source of truth for the Experience.com brand mark.
 * Swap the raster/vector artwork here and every surface updates.
 */
export function BrandIcon({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src="/brand/experience-icon.png"
      alt="Experience.com"
      className={cn("shrink-0 object-contain", className)}
      style={{ height: size, width: "auto" }}
    />
  );
}

export function BrandWordmark({
  size = 24,
  variant = "light",
  className,
  textClassName,
}: {
  size?: number;
  /** "dark" = for use on dark backgrounds (white text). */
  variant?: "light" | "dark";
  className?: string;
  textClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <BrandIcon size={size} />
      <span
        className={cn(
          "font-bold lowercase tracking-tight leading-none",
          variant === "dark" ? "text-white" : "text-[#12294D]",
          textClassName,
        )}
        style={{ fontSize: size * 0.72 }}
      >
        experience.com
      </span>
    </span>
  );
}
