// Render smoke test: every Happyflow screen renders on the server without throwing, inside .hf-root, and no two
// screens render the same markup. It does not check what a screen says.
// There is no DOM in this test setup, so this covers the first render only (no effects, no clicks).
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { describe, expect, test } from "bun:test";
import { HfPersonaProvider } from "../persona-context";
import { SampleData, SAMPLE_DATA_LABEL } from "../sample-data";
import { HomeDay1Screen } from "./home-day1";
import { HomeDay7Screen } from "./home-day7";
import { SrsScreen } from "./srs";
import { ProfileScreen } from "./profile";
import { InsightsScreen } from "./insights";
import { WebsiteScreen } from "./website";
import { ConnectionsScreen } from "./connections";
import { NetworkScreen } from "./network";
import { SettingsScreen } from "./settings";
import { FindYouScreen } from "./find-you";
import { InterviewScreen } from "./interview";

async function render(Screen: ComponentType): Promise<string> {
  const root = createRootRoute();
  const seat = createRoute({ getParentRoute: () => root, path: "/seat/$kind/$id", component: Screen });
  const router = createRouter({
    routeTree: root.addChildren([seat]),
    history: createMemoryHistory({ initialEntries: ["/seat/professional/p1"] }),
  });
  await router.load();
  return renderToString(createElement(RouterProvider, { router }));
}

const SCREENS: [string, ComponentType][] = [
  ["home day 1", HomeDay1Screen],
  ["home day 7", () => createElement(HomeDay7Screen, { day: 7, events: false })],
  ["home day 7 events", () => createElement(HomeDay7Screen, { day: 7, events: true })],
  ["home day 24", () => createElement(HomeDay7Screen, { day: 24, events: false })],
  ["srs", SrsScreen],
  ["profile", ProfileScreen],
  ["insights", InsightsScreen],
  ["website", WebsiteScreen],
  ["connections", ConnectionsScreen],
  ["network", NetworkScreen],
  ["settings", SettingsScreen],
  ["find you", FindYouScreen],
  ["interview", InterviewScreen],
];

describe("Happyflow screens render", () => {
  test("the sample-data notice is visible and wraps its screen", async () => {
    const html = await render(() => createElement(SampleData, null, createElement(SettingsScreen)));
    expect(html).toContain(SAMPLE_DATA_LABEL);
    expect(html.indexOf(SAMPLE_DATA_LABEL)).toBeLessThan(html.indexOf("hf-root"));
  });

  test("each screen renders different markup", async () => {
    // "home day 7 events" differs from "home day 7" only after an effect runs (home-day7.tsx), so a server render
    // cannot tell them apart; it is left out of this comparison.
    const screens = SCREENS.filter(([name]) => name !== "home day 7 events");
    const out = await Promise.all(screens.map(([, Screen]) => render(Screen)));
    const seen = new Map<string, string>();
    const dup: string[] = [];
    screens.forEach(([name], i) => {
      const first = seen.get(out[i]);
      if (first) dup.push(`${name} = ${first}`);
      else seen.set(out[i], name);
    });
    expect(dup).toEqual([]);
  });

  for (const [name, Screen] of SCREENS) {
    test(name, async () => {
      const html = await render(Screen);
      expect(html.length).toBeGreaterThan(1000);
      expect(html).toContain("hf-root");
    });
  }
});

describe("the home shows the signed-in professional", () => {
  const seat = { pro: { first_name: "Harper", last_name: "Jones", display_name: "Harper Jones", job_title: null }, office: null };
  const withSeat = (Screen: ComponentType) => () =>
    createElement(HfPersonaProvider, { seat: seat as never }, createElement(Screen));

  test("day 1 greets by the real first name, not Alex", async () => {
    const html = await render(withSeat(HomeDay1Screen));
    expect(html).toMatch(/, Harper/);
    expect(html).not.toMatch(/(Morning|afternoon|evening|Good \w+), Alex/i);
  });

  test("day 7 greets by the real first name, not Alex", async () => {
    const html = await render(withSeat(() => createElement(HomeDay7Screen, { day: 7, events: false })));
    expect(html).toMatch(/, Harper/);
    expect(html).not.toMatch(/, Alex/);
  });

  test("without a seat the sample persona is still used", async () => {
    const html = await render(HomeDay1Screen);
    expect(html).toMatch(/, Alex/);
  });

  test("the notice says the name is real when it is", async () => {
    const html = await render(() =>
      createElement(HfPersonaProvider, { seat: seat as never }, createElement(SampleData, null, createElement(SettingsScreen))),
    );
    expect(html).toContain("Your name");
  });
});

describe("no screen still says Alex for a real person", () => {
  const seat = {
    pro: { first_name: "Harper", last_name: "Jones", display_name: "Harper Jones", job_title: null, email: "harper@example.test", phone: null, slug: "harper-jones" },
    office: null,
  };
  for (const [name, Screen] of SCREENS) {
    test(name, async () => {
      const html = await render(() =>
        createElement(HfPersonaProvider, { seat: seat as never }, createElement(Screen)),
      );
      const text = html.replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/g, " ");
      expect(text).not.toMatch(/Alex/i); // also alex.sample@… and …/alex-sample
    });
  }
});
