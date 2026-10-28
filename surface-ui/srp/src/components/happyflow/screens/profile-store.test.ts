import { afterEach, describe, expect, test } from "bun:test";
import { STORE_KEY, loadStored, saveStored, storeKeyFor } from "./profile-store";

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
    g.window = { localStorage: memoryStorage({ [STORE_KEY]: JSON.stringify({ f: "abc" }) }) };
    expect(loadStored(INITIAL)).toBeNull();
    g.window = { localStorage: memoryStorage({ [STORE_KEY]: JSON.stringify({ f: ["x"] }) }) };
    expect(loadStored(INITIAL)).toBeNull();
  });

  test("saves when there are edits, and clears when there are none", () => {
    const s = memoryStorage();
    g.window = { localStorage: s };
    saveStored({ name: "Z", bio: "B" }, { name: "chat" });
    expect(JSON.parse(s.data[STORE_KEY])).toEqual({ f: { name: "Z" }, src: { name: "chat" } }); // only the edited fact is kept
    saveStored({ name: "A", bio: "B" }, {});
    expect(STORE_KEY in s.data).toBe(false);
  });

  test("blocked storage does not throw", () => {
    g.window = { localStorage: throwing };
    expect(loadStored(INITIAL)).toBeNull();
    expect(() => saveStored(INITIAL, { name: "x" })).not.toThrow();
  });
});

describe("demo profile storage per seat", () => {
  test("the sample page keeps the original key and a real seat gets its own", () => {
    expect(storeKeyFor(null)).toBe(STORE_KEY);
    expect(storeKeyFor("34")).toBe("hf-demo-profile:34");
    expect(storeKeyFor("34")).not.toBe(storeKeyFor("35"));
  });

  test("one seat's edits are not read by another seat or by the sample page", () => {
    const storage = memoryStorage();
    g.window = { localStorage: storage };
    saveStored({ name: "Seat A", bio: "B" }, { name: "typed" }, storeKeyFor("1"));
    expect(Object.keys(storage.data)).toEqual(["hf-demo-profile:1"]);
    expect(loadStored(INITIAL, storeKeyFor("1"))).toEqual({ f: { name: "Seat A", bio: "B" }, src: { name: "typed" } });
    expect(loadStored(INITIAL, storeKeyFor("2"))).toBeNull();
    expect(loadStored(INITIAL)).toBeNull();
  });

  test("clearing the edits of one seat leaves the others", () => {
    const storage = memoryStorage();
    g.window = { localStorage: storage };
    saveStored({ name: "A", bio: "B" }, { name: "x" }, storeKeyFor("1"));
    saveStored({ name: "C", bio: "D" }, { name: "y" }, storeKeyFor("2"));
    saveStored({ name: "A", bio: "B" }, {}, storeKeyFor("1"));
    expect(Object.keys(storage.data)).toEqual(["hf-demo-profile:2"]);
  });

  test("without a key the original behaviour is unchanged", () => {
    const storage = memoryStorage();
    g.window = { localStorage: storage };
    saveStored({ name: "Z", bio: "B" }, { name: "chat" });
    expect(Object.keys(storage.data)).toEqual([STORE_KEY]);
  });
});

describe("only the edited facts are kept", () => {
  test("a fact the person did not edit is never frozen: a later change in the database shows", () => {
    const storage = memoryStorage();
    g.window = { localStorage: storage };
    saveStored({ name: "Z", bio: "B" }, { name: "typed" });
    expect(JSON.parse(storage.data[STORE_KEY])).toEqual({ f: { name: "Z" }, src: { name: "typed" } });
    expect(loadStored({ name: "A", bio: "A newer bio" })).toEqual({ f: { name: "Z", bio: "A newer bio" }, src: { name: "typed" } });
  });

  test("an edit is kept with its source and the rest of the fields come from the current initial values", () => {
    g.window = { localStorage: memoryStorage() };
    saveStored({ name: "Z", bio: "Y" }, { name: "typed", bio: "voice" }, storeKeyFor("1"));
    expect(loadStored({ name: "A", bio: "B" }, storeKeyFor("1"))).toEqual({ f: { name: "Z", bio: "Y" }, src: { name: "typed", bio: "voice" } });
  });
});

