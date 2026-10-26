import { afterEach, describe, expect, test } from "bun:test";
import { STORE_KEY, loadStored, saveStored } from "./profile-store";

const g = globalThis as unknown as { window?: unknown };
const original = g.window;
afterEach(() => {
  g.window = original;
});

const INITIAL = { name: "A", bio: "B" };

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

describe("demo profile storage", () => {
  test("uses the browser-only key from the spec", () => {
    expect(STORE_KEY).toBe("hf-demo-profile");
  });

  test("nothing stored gives null", () => {
    g.window = { localStorage: memoryStorage() };
    expect(loadStored(INITIAL)).toBeNull();
  });

  test("merges stored fields over the initial ones", () => {
    g.window = {
      localStorage: memoryStorage({
        [STORE_KEY]: JSON.stringify({ f: { name: "Z" }, src: { name: "chat" } }),
      }),
    };
    expect(loadStored(INITIAL)).toEqual({ f: { name: "Z", bio: "B" }, src: { name: "chat" } });
  });

  test("malformed or wrong-shaped content is discarded", () => {
    g.window = { localStorage: memoryStorage({ [STORE_KEY]: "{not json" }) };
    expect(loadStored(INITIAL)).toBeNull();
    g.window = { localStorage: memoryStorage({ [STORE_KEY]: JSON.stringify({ nope: 1 }) }) };
    expect(loadStored(INITIAL)).toBeNull();
    g.window = { localStorage: memoryStorage({ [STORE_KEY]: "null" }) };
    expect(loadStored(INITIAL)).toBeNull();
  });

  test("saves when there are edits, and clears when there are none", () => {
    const s = memoryStorage();
    g.window = { localStorage: s };
    saveStored({ name: "Z", bio: "B" }, { name: "chat" });
    expect(JSON.parse(s.data[STORE_KEY])).toEqual({ f: { name: "Z", bio: "B" }, src: { name: "chat" } });
    saveStored({ name: "A", bio: "B" }, {});
    expect(STORE_KEY in s.data).toBe(false);
  });

  test("blocked storage does not throw", () => {
    g.window = { localStorage: throwing };
    expect(loadStored(INITIAL)).toBeNull();
    expect(() => saveStored(INITIAL, { name: "x" })).not.toThrow();
  });
});
