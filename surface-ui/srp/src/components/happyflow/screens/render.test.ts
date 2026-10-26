// Render smoke test: every Happyflow screen renders on the server without throwing and shows its own content.
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
  for (const [name, Screen] of SCREENS) {
    test(name, async () => {
      const html = await render(Screen);
      expect(html.length).toBeGreaterThan(1000);
      expect(html).toContain("hf-root");
    });
  }
});
