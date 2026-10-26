import { Lock } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@v3/shared/components/ui/tooltip";

export const MODEL_LOCK_MESSAGE =
  "Model editing routes through governed functions — coming with the Hierarchy release";

/** Small lock chip shown where a model-editing affordance used to be (Ruling R21). */
export function ModelLock({ label = "Locked", className }: { label?: string; className?: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={
              "inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 " +
              (className ?? "")
            }
          >
            <Lock className="h-3 w-3" />
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">{MODEL_LOCK_MESSAGE}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Banner for a whole read-only model section. */
export function ModelLockNotice({ className }: { className?: string }) {
  return (
    <div
      className={
        "flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 " +
        (className ?? "")
      }
    >
      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
      <span>{MODEL_LOCK_MESSAGE}</span>
    </div>
  );
}

/** Read-only chip shown when the active role is Analyst. */
export function ReadOnlyLock({ className }: { className?: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={
              "inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 " +
              (className ?? "")
            }
          >
            <Lock className="h-3 w-3" />
            Read-only
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">
          Your active role is Analyst — this view is read-only.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
