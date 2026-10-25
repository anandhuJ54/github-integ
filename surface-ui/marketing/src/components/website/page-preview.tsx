import { useState } from "react";
import { Monitor, Smartphone, ExternalLink } from "lucide-react";
import { BlockRenderer } from "@v3/ui/components/public/blocks";
import { Button } from "@v3/ui/components/ui/button";
import type { Block } from "@v3/ui/lib/public-site";

/**
 * Live preview column for the CMS edit drawer. Renders the blocks currently
 * being edited with the same public renderer the site uses, so the look and
 * feel matches what visitors see. Pages whose layout is built in code are
 * previewed through their real route in an iframe.
 */
export function PagePreview({
  title,
  blocks,
  routePath,
  codeRendered,
}: {
  title: string;
  blocks: Block[];
  routePath?: string | null;
  codeRendered?: boolean | null;
}) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const isMobile = device === "mobile";
  const frameWidth = isMobile ? 390 : 1280;
  const scale = isMobile ? 1 : 0.42;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-ink">Preview</div>
          <p className="text-xs text-[color:var(--color-ink-3)]">
            {codeRendered
              ? "Live page, rendered from its coded layout."
              : "Updates as you edit — same rendering as the public site."}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-full bg-[color:var(--color-surface-3)] p-1">
          <Button
            size="sm"
            variant={isMobile ? "ghost" : "secondary"}
            className="h-7 rounded-full px-3"
            onClick={() => setDevice("desktop")}
          >
            <Monitor className="mr-1 h-3.5 w-3.5" /> Desktop
          </Button>
          <Button
            size="sm"
            variant={isMobile ? "secondary" : "ghost"}
            className="h-7 rounded-full px-3"
            onClick={() => setDevice("mobile")}
          >
            <Smartphone className="mr-1 h-3.5 w-3.5" /> Mobile
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[color:var(--color-hairline)] bg-white">
        <div className="flex items-center gap-2 border-b border-[color:var(--color-hairline)] px-3 py-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#f1f3f4]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#f1f3f4]" />
          <span className="truncate text-xs text-[color:var(--color-ink-3)]">{routePath || title}</span>
          {routePath ? (
            <a
              href={routePath}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-xs text-[#1a73e8]"
            >
              Open <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </div>

        {codeRendered && routePath ? (
          <iframe
            key={`${routePath}-${device}`}
            src={routePath}
            title={`Preview of ${title}`}
            className="block h-[560px] w-full border-0 bg-white"
          />
        ) : blocks.length ? (
          <div className="h-[560px] overflow-y-auto bg-white">
            <div
              style={{
                width: frameWidth,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
                marginBottom: scale < 1 ? `-${(1 - scale) * 100}%` : undefined,
              }}
            >
              <BlockRenderer blocks={blocks} />
            </div>
          </div>
        ) : (
          <div className="flex h-[560px] items-center justify-center px-6 text-center text-sm text-[color:var(--color-ink-3)]">
            Nothing to preview yet — add a block to see it here.
          </div>
        )}
      </div>
    </div>
  );
}
