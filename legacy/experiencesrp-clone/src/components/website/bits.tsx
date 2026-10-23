import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

const PILLS: Record<string, string> = {
  published: "bg-[color:var(--color-g-green-soft)] text-[#1e8e3e]",
  active: "bg-[color:var(--color-g-green-soft)] text-[#1e8e3e]",
  qualified: "bg-[color:var(--color-g-green-soft)] text-[#1e8e3e]",
  live: "bg-[color:var(--color-g-green-soft)] text-[#1e8e3e]",
  draft: "bg-[color:var(--color-surface-3)] text-[color:var(--color-ink-2)]",
  paused: "bg-[color:var(--color-g-yellow-soft)] text-[#b06000]",
  new: "bg-[color:var(--color-g-blue-soft)] text-[color:var(--color-g-blue)]",
  contacted: "bg-[color:var(--color-g-purple-soft)] text-[#7b4ce0]",
  ignored: "bg-[color:var(--color-g-red-soft)] text-[#c5221f]",
  ended: "bg-[color:var(--color-surface-3)] text-[color:var(--color-ink-3)]",
};

/** Dense status chip used across every Website module. */
export function Pill({ value, className }: { value: string | null | undefined; className?: string }) {
  const v = (value ?? "—").toLowerCase();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        PILLS[v] ?? "bg-[color:var(--color-surface-3)] text-[color:var(--color-ink-2)]",
        className,
      )}
    >
      {value ?? "—"}
    </span>
  );
}

/** Honest note for metrics that need a live source connected before they mean anything. */
export function InstrumentNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-[14px] border border-dashed border-[color:var(--color-hairline)] bg-[color:var(--color-surface-2)] px-4 py-3 text-xs leading-relaxed text-[color:var(--color-ink-2)]">
      <Info className="mt-[1px] h-3.5 w-3.5 shrink-0 text-[color:var(--color-ink-3)]" />
      <span>
        <span className="font-semibold text-ink">Instrument to activate. </span>
        {children}
      </span>
    </div>
  );
}

export function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-ink-3)]">
        {label}
      </span>
      {children}
    </label>
  );
}
