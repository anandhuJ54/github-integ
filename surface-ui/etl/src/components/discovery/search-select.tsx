import { useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@v3/ui/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@v3/etl/components/ui/command";
import { cn } from "@v3/ui/lib/utils";

export type Opt = { value: string; label: string; hint?: string };

/** Searchable select. Filtering is done by the caller (onSearch) or locally over `options`. */
export function SearchSelect({
  placeholder,
  value,
  valueLabel,
  options,
  onChange,
  onSearch,
  allowCustom,
  className,
}: {
  placeholder: string;
  value?: string;
  valueLabel?: string;
  options: Opt[];
  onChange: (v: string | undefined) => void;
  onSearch?: (term: string) => void;
  allowCustom?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const t = term.trim().toLowerCase();
  const shown = onSearch
    ? options
    : options.filter((o) => !t || o.label.toLowerCase().includes(t) || o.value.toLowerCase().includes(t));
  const pick = (v: string | undefined) => {
    onChange(v);
    setOpen(false);
    setTerm("");
    onSearch?.("");
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-9 min-w-[160px] items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-left text-sm",
            className,
          )}
        >
          <span className={cn("flex-1 truncate", !value && "text-slate-400")}>
            {value ? valueLabel ?? value : placeholder}
          </span>
          {value ? (
            <X
              className="h-3.5 w-3.5 text-slate-400 hover:text-slate-600"
              onClick={(e) => {
                e.stopPropagation();
                pick(undefined);
              }}
            />
          ) : (
            <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search…"
            value={term}
            onValueChange={(v) => {
              setTerm(v);
              onSearch?.(v);
            }}
          />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup>
              {allowCustom && term.trim() ? (
                <CommandItem value={`custom:${term}`} onSelect={() => pick(term.trim())}>
                  Use “{term.trim()}”
                </CommandItem>
              ) : null}
              {shown.map((o) => (
                <CommandItem key={o.value} value={o.value} onSelect={() => pick(o.value)}>
                  <Check className={cn("mr-2 h-3.5 w-3.5", value === o.value ? "opacity-100" : "opacity-0")} />
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.hint ? <span className="ml-2 truncate text-[10px] text-slate-400">{o.hint}</span> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
