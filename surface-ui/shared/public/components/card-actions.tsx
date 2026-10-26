import { Mail, MapPinned, Phone, Globe } from "lucide-react";
import type { CardAction } from "@v3/shared/public/utils/engagement.functions";
import { cn } from "@v3/shared/components/utils/utils";

const CLASS =
  "inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-amber-400 hover:bg-amber-50";

/** Real conversion actions read from the graph; each one hides when absent. */
export function CardActions({
  actions,
  name,
  className,
}: {
  actions?: CardAction;
  name: string;
  className?: string;
}) {
  if (!actions) return null;
  const directions = actions.address
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(actions.address)}`
    : null;
  if (!actions.phone && !actions.website && !directions && !actions.email) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {actions.phone ? (
        <a href={`tel:${actions.phone.replace(/[^\d+]/g, "")}`} className={CLASS} aria-label={`Call ${name}`}>
          <Phone className="h-3.5 w-3.5 text-amber-700" aria-hidden="true" /> Call
        </a>
      ) : null}
      {actions.website ? (
        <a
          href={actions.website}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className={CLASS}
          aria-label={`${name} website`}
        >
          <Globe className="h-3.5 w-3.5 text-amber-700" aria-hidden="true" /> Website
        </a>
      ) : null}
      {directions ? (
        <a href={directions} target="_blank" rel="noopener noreferrer" className={CLASS} aria-label={`Directions to ${name}`}>
          <MapPinned className="h-3.5 w-3.5 text-amber-700" aria-hidden="true" /> Directions
        </a>
      ) : null}
      {actions.email ? (
        <a href={`mailto:${actions.email}`} className={CLASS} aria-label={`Message ${name}`}>
          <Mail className="h-3.5 w-3.5 text-amber-700" aria-hidden="true" /> Message
        </a>
      ) : null}
    </div>
  );
}
