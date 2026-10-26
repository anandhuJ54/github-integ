import { useCallback, useEffect, useState } from "react";

export type HfDeviceOverride = "mobile" | "desktop" | null;

const KEY = "hf-device";

export function readOverride(): HfDeviceOverride {
  try {
    const v = window.sessionStorage.getItem(KEY);
    return v === "mobile" || v === "desktop" ? v : null;
  } catch {
    return null;
  }
}

export function writeOverride(d: HfDeviceOverride): void {
  try {
    if (d) window.sessionStorage.setItem(KEY, d);
    else window.sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable — the toggle still works for this page */
  }
}

/**
 * Viewport + the prototype's Mobile / Desktop demo toggle. Desktop layout from 1024 px; a forced
 * mobile layout on a wide window renders inside a 390 px phone frame (`framed`).
 * The override lives in sessionStorage so it survives moving between Happyflow screens.
 */
export function useHfDevice() {
  const [w, setW] = useState(() => (typeof window === "undefined" ? 1440 : window.innerWidth));
  const [dev, setDevState] = useState<HfDeviceOverride>(() =>
    typeof window === "undefined" ? null : readOverride(),
  );
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const setDev = useCallback((d: HfDeviceOverride) => {
    setDevState(d);
    writeOverride(d);
  }, []);
  const isD = dev === "desktop" || (dev !== "mobile" && w >= 1024);
  const isM = !isD;
  const framed = isM && w >= 500;
  return { w, isD, isM, framed, dev, setDev };
}
