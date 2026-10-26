import type { ReactNode } from "react";
import { HF_SAMPLE_BANNER_HEIGHT } from "./seat-nav";

export const SAMPLE_DATA_LABEL = "Sample data";
export const SAMPLE_DATA_NOTE =
  "These screens show example values, not your real profile, score or activity.";

/**
 * Wraps a Happyflow screen in the seat. Every number, name and score on these screens is demo data
 * (see demo-data.ts), so each one carries this notice until it is wired to real data.
 */
export function SampleData({ children }: { children: ReactNode }) {
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
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{SAMPLE_DATA_NOTE}</span>
      </div>
      {children}
    </div>
  );
}
