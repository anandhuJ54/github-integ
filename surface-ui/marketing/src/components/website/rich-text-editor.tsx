import { useEffect, useRef, useState } from "react";
import {
  Bold,
  Italic,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Link2,
  Quote,
  Undo2,
  Redo2,
  Eraser,
  Code2,
} from "lucide-react";
import { cn } from "@v3/ui/lib/utils";
import { Button } from "@v3/ui/components/ui/button";
import { Textarea } from "@v3/ui/components/ui/textarea";
import { sanitizeHtml } from "@v3/ui/lib/public-site";

type Cmd = {
  icon: typeof Bold;
  label: string;
  run: () => void;
};

/**
 * Lightweight WYSIWYG editor (contenteditable + document.execCommand).
 * Emits sanitized HTML so the same value is safe to render on the public site
 * and reusable by the Trust Center editor.
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder = "Write…",
  minHeight = 200,
  className,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<"visual" | "html">("visual");

  // Only sync inbound value when the editor isn't the source of the change.
  useEffect(() => {
    const el = ref.current;
    if (!el || mode !== "visual") return;
    if (el.innerHTML !== value) el.innerHTML = value || "";
  }, [value, mode]);

  const exec = (command: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(command, false, arg);
    emit();
  };

  const emit = () => {
    const el = ref.current;
    if (el) onChange(sanitizeHtml(el.innerHTML));
  };

  const commands: Cmd[] = [
    { icon: Bold, label: "Bold", run: () => exec("bold") },
    { icon: Italic, label: "Italic", run: () => exec("italic") },
    { icon: Heading2, label: "Heading", run: () => exec("formatBlock", "H2") },
    { icon: Heading3, label: "Subheading", run: () => exec("formatBlock", "H3") },
    { icon: Quote, label: "Quote", run: () => exec("formatBlock", "BLOCKQUOTE") },
    { icon: List, label: "Bullet list", run: () => exec("insertUnorderedList") },
    { icon: ListOrdered, label: "Numbered list", run: () => exec("insertOrderedList") },
    {
      icon: Link2,
      label: "Link",
      run: () => {
        const href = window.prompt("Link URL (https://… or /path)");
        if (href) exec("createLink", href);
      },
    },
    { icon: Eraser, label: "Clear formatting", run: () => exec("removeFormat") },
    { icon: Undo2, label: "Undo", run: () => exec("undo") },
    { icon: Redo2, label: "Redo", run: () => exec("redo") },
  ];

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[12px] border border-[color:var(--color-hairline)] bg-white",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-0.5 border-b border-[color:var(--color-hairline)] bg-[color:var(--color-surface-2)] px-2 py-1.5">
        {mode === "visual"
          ? commands.map((c) => (
              <button
                key={c.label}
                type="button"
                title={c.label}
                aria-label={c.label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={c.run}
                className="rounded-md p-1.5 text-[color:var(--color-ink-2)] transition-colors hover:bg-[color:var(--color-surface-3)] hover:text-ink"
              >
                <c.icon className="h-3.5 w-3.5" />
              </button>
            ))
          : (
            <span className="px-1 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-ink-3)]">
              HTML source
            </span>
          )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto h-7 gap-1.5 px-2 text-xs"
          onClick={() => setMode((m) => (m === "visual" ? "html" : "visual"))}
        >
          <Code2 className="h-3.5 w-3.5" />
          {mode === "visual" ? "HTML" : "Visual"}
        </Button>
      </div>

      {mode === "visual" ? (
        <div
          ref={ref}
          role="textbox"
          aria-multiline="true"
          aria-label={placeholder}
          contentEditable
          suppressContentEditableWarning
          onInput={emit}
          onBlur={emit}
          data-placeholder={placeholder}
          style={{ minHeight }}
          className={cn(
            "prose-editor max-w-none px-4 py-3 text-sm leading-relaxed text-ink outline-none",
            "[&_h2]:mt-3 [&_h2]:text-lg [&_h2]:font-semibold",
            "[&_h3]:mt-3 [&_h3]:text-base [&_h3]:font-semibold",
            "[&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
            "[&_a]:text-[#1E87E5] [&_a]:underline",
            "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-[color:var(--color-hairline)] [&_blockquote]:pl-3 [&_blockquote]:italic",
            "empty:before:text-[color:var(--color-ink-3)] empty:before:content-[attr(data-placeholder)]",
          )}
        />
      ) : (
        <Textarea
          rows={12}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="rounded-none border-0 font-mono text-xs focus-visible:ring-0"
        />
      )}
    </div>
  );
}
