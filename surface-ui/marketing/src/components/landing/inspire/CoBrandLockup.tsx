import { EXPERIENCE_LOGO_URL, INSPIRE_LOGO_URL } from "./brand";

function BrushX({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      className={`aspect-square shrink-0 ${className ?? ""}`}
      aria-hidden="true"
    >
      {/* hand-drawn style x: two slightly curved, tapered strokes */}
      <path
        d="M12 10 C 18 18, 28 30, 37 40"
        stroke="currentColor"
        strokeWidth="6.5"
        strokeLinecap="round"
      />
      <path
        d="M36 9 C 30 20, 20 32, 11 41"
        stroke="currentColor"
        strokeWidth="6.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function CoBrandLockup() {
  return (
    <div className="flex w-full items-center gap-3 sm:gap-7">
      <img
        src={EXPERIENCE_LOGO_URL}
        alt="Experience.com"
        className="h-5 w-auto max-w-[40%] shrink object-contain object-left brightness-0 sm:h-9 sm:max-w-none"
      />
      <BrushX className="h-4 w-4 text-navy sm:h-6 sm:w-6" />
      <img
        src={INSPIRE_LOGO_URL}
        alt="Inspire Network"
        className="h-4 w-auto max-w-[38%] shrink object-contain object-right brightness-0 sm:h-7 sm:max-w-none"
      />
    </div>
  );
}
