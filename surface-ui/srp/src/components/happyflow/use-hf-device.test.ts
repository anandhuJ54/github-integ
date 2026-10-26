import { afterEach, describe, expect, test } from "bun:test";
import { readOverride, writeOverride } from "./use-hf-device";

const g = globalThis as unknown as { window?: unknown };
const original = g.window;
afterEach(() => {
  g.window = original;
});

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => void (data[k] = v),
    removeItem: (k: string) => void delete data[k],
  };
}
const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("device override storage", () => {
  test("reads only mobile or desktop", () => {
    g.window = { sessionStorage: memoryStorage({ "hf-device": "mobile" }) };
    expect(readOverride()).toBe("mobile");
    g.window = { sessionStorage: memoryStorage({ "hf-device": "desktop" }) };
    expect(readOverride()).toBe("desktop");
    g.window = { sessionStorage: memoryStorage({ "hf-device": "tablet" }) };
    expect(readOverride()).toBeNull();
    g.window = { sessionStorage: memoryStorage() };
    expect(readOverride()).toBeNull();
  });

  test("writes, and clears on null", () => {
    const s = memoryStorage();
    g.window = { sessionStorage: s };
    writeOverride("mobile");
    expect(s.data["hf-device"]).toBe("mobile");
    writeOverride(null);
    expect("hf-device" in s.data).toBe(false);
  });

  test("blocked storage does not throw", () => {
    g.window = { sessionStorage: throwing };
    expect(readOverride()).toBeNull();
    expect(() => writeOverride("desktop")).not.toThrow();
  });
});
