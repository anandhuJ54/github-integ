import { describe, expect, test } from "bun:test";
import { api } from "./connections-fixture";
import {
  CARD_META,
  connectionsKey,
  connectionsModel,
  type ConnectionsApi,
} from "./connections-model";
import { sampleConnectionsModel } from "../components/happyflow/sample-connections";

const m = (over: Partial<ConnectionsApi> = {}) => connectionsModel(api(over), "34")!;

describe("connectionsModel", () => {
  test("a response that is not ready, or has no accounts, or is missing gives no model (the sample page)", () => {
    expect(connectionsModel(null)).toBeNull();
    expect(connectionsModel(undefined)).toBeNull();
    expect(connectionsModel(api({ ready: false, accounts: null, summary: null }))).toBeNull();
    expect(connectionsModel(api({ accounts: null }))).toBeNull();
  });

  test("a ready response maps every section", () => {
    const model = m();
    expect(model.mode).toBe("real");
    expect(model.seatKey).toBe("34");
    expect(model.isMock).toBe(true);
    expect([model.connected, model.matched]).toEqual([5, 1]);
    expect(model.cards).toHaveLength(11);
    expect(model.cards.map((c) => c.type)).toEqual([
      "on",
      "on",
      "connect",
      "connect",
      "on",
      "on",
      "connect",
      "connect",
      "matched",
      "connect",
      "on",
    ]);
    expect(model.cards[0]).toEqual({
      key: "google_business",
      name: "Google Business Profile",
      mono: "G",
      color: "#4285f4",
      type: "on",
      status: "Connected · synced Oct 24",
      powers: "GBP lane (41 of 68), hours, photos, reviews",
    });
    expect(model.suggest).toEqual([{ key: "website_cms", name: "Website / CMS" }]);
    expect(model.thinks).toEqual([
      {
        t: "Your Website / CMS would let me apply fixes.",
        d: "Right now I can only hand them to your webmaster.",
        cta: "Connect it",
        connect: "Website / CMS",
      },
    ]);
    expect(model.locked).toBeNull();
  });

  test("live data is not mock", () => {
    expect(m({ data: "live" }).isMock).toBe(false);
  });

  test("a partial account is a partial card, and an account that is missing has no card", () => {
    const a = api();
    a.accounts = a
      .accounts!.filter((x) => x.key !== "x")
      .map((x) => (x.key === "yelp" ? { ...x, state: "partial" as const } : x));
    const model = connectionsModel(a, "1")!;
    expect(model.cards).toHaveLength(10);
    expect(model.cards.find((c) => c.key === "yelp")!.type).toBe("partial");
    expect(model.cards.some((c) => c.key === "x")).toBe(false);
  });

  test("the directories card and missing sections are carried or empty, never invented", () => {
    const card = { title: "Publish your details.", text: "Unlock with Engage." };
    expect(m({ locked: card }).locked).toEqual(card);
    const bare = m({ summary: null, suggest: null, notes: null });
    expect([bare.connected, bare.matched, bare.suggest, bare.thinks]).toEqual([0, 0, [], []]);
  });

  test("the cache key is per seat", () => {
    expect(connectionsKey("1")).not.toEqual(connectionsKey("2"));
  });
});

describe("the sample model", () => {
  const s = sampleConnectionsModel();
  test("is the prototype's eleven accounts, in the page's order and colours", () => {
    expect(s.mode).toBe("sample");
    expect(s.cards.map((c) => c.name)).toEqual([
      "Google Business Profile",
      "Search Console",
      "YouTube",
      "Facebook",
      "Instagram",
      "LinkedIn",
      "X",
      "Zillow",
      "Yelp",
      "Website / CMS",
      "Loan system (Encompass)",
    ]);
    expect(s.cards.map((c) => [c.mono, c.color, c.type])).toEqual([
      ["G", "#4285f4", "on"],
      ["SC", "#34a853", "connect"],
      ["YT", "#ea4335", "on"],
      ["f", "#1877f2", "on"],
      ["IG", "#d6249f", "connect"],
      ["in", "#0a66c2", "on"],
      ["X", "#202124", "connect"],
      ["Z", "#006aff", "matched"],
      ["Y", "#d32323", "partial"],
      ["W", "#5f6368", "connect"],
      ["E", "#7b4ce0", "connect"],
    ]);
    expect(Object.keys(CARD_META)).toHaveLength(11);
  });
  test("the header counts, the suggestions, the notes and the card are the prototype's", () => {
    expect([s.connected, s.matched]).toEqual([4, 2]);
    expect(s.suggest.map((x) => x.name)).toEqual(["Search Console", "Website / CMS"]);
    expect(s.thinks.map((x) => x.t)).toEqual([
      "Search Console is one tap away.",
      "Your Website / CMS would let me apply fixes.",
    ]);
    expect(s.locked?.title).toBe("Publish your details to Apple Maps, Bing and 28 directories.");
    expect(s.locked?.text).toBe("Unlock with Engage, included in Amplify.");
  });
  test("statuses and powers are the prototype's", () => {
    expect(s.cards[0].status).toBe("Connected · synced today");
    expect(s.cards[0].powers).toBe("GBP lane (67 of 68), hours, photos, reviews");
    expect(s.cards[8].status).toBe("Match found · replies need Yelp's partner access");
    expect(s.cards[4].status).toBe("");
  });
});
