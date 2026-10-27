import type { ReactNode } from "react";
import { HF_SAMPLE_BANNER_HEIGHT } from "./seat-nav";
import { SAMPLE_DATA_NOTE, sampleNoticeFor } from "./persona";
import { useHfPersona } from "./persona-context";

export const SAMPLE_DATA_LABEL = "Sample data";
export { SAMPLE_DATA_NOTE };

/**
 * Wraps a Happyflow screen in the seat. Every number, name and score on these screens is demo data
 * (see demo-data.ts), so each one carries this notice until it is wired to real data.
 */
export function SampleData({ children, note }: { children: ReactNode; note?: string }) {
  const { isReal } = useHfPersona();
  const text = note ?? sampleNoticeFor(isReal);
  return (
    <div>
      <div
        role="note"
        style={{
          height: HF_SAMPLE_BANNER_HEIGHT - 8,
          marginBottom: 8,
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderRadius: 10,
          background: "#fef7e0",
          border: "1px solid #fde293",
          padding: "0 12px",
          fontSize: 12.5,
          color: "#7a4f01",
          overflow: "hidden",
          whiteSpace: "nowrap",
        }}
      >
        <strong style={{ fontWeight: 700, flex: "none" }}>{SAMPLE_DATA_LABEL}</strong>
        <span title={text} style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {text}
        </span>
      </div>
      {children}
    </div>
  );
}
