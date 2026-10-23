import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface CategoryOption {
  readonly label: string;
  readonly value: string;
}

interface MobileCategoryAccordionProps<T extends string> {
  categories: readonly CategoryOption[];
  activeCategory: T;
  onChange: (value: T) => void;
}

export function MobileCategoryAccordion<T extends string>({
  categories,
  activeCategory,
  onChange,
}: MobileCategoryAccordionProps<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const activeLabel =
    categories.find((c) => c.value === activeCategory)?.label ?? categories[0]?.label;

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="sm:hidden mb-6" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-4 py-3 rounded-2xl bg-white border border-slate-200 text-slate-900 text-[15px] font-medium shadow-sm"
      >
        <span>{activeLabel}</span>
        <ChevronDown
          className={`w-5 h-5 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        className={`grid transition-all duration-200 ease-out ${
          open ? "grid-rows-[1fr] opacity-100 mt-2" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="rounded-2xl bg-white border border-slate-200 shadow-sm py-1.5">
            {categories.map((cat) => {
              const isActive = cat.value === activeCategory;
              return (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => {
                    onChange(cat.value as T);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-4 py-2.5 text-[15px] transition-colors ${
                    isActive
                      ? "text-[#2196F3] font-semibold bg-blue-50/60"
                      : "text-slate-700 font-medium hover:bg-slate-50"
                  }`}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default MobileCategoryAccordion;
