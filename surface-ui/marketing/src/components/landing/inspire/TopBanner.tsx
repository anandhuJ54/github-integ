import { useInspireCopy } from "./copy";

export function TopBanner() {
  const copy = useInspireCopy();
  return (
    <div className="bg-charcoal text-white">
      <div className="mx-auto flex w-full max-w-[1200px] items-center justify-center px-8 py-2 sm:px-12">
        <p className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-white/85 sm:text-[0.68rem]">
          {copy.banner}
        </p>
      </div>
    </div>
  );
}
