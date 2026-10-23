import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { useBrowser } = await import("../store/browser.ts");
const { linkRoutingConfig } = await import("./linkRoutes.ts");

const S = () => useBrowser.getState();
const PROFILES = {
  default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 },
  work: { id: "work", name: "Work", color: "blue", icon: null, createdAt: 0 },
};
S().hydrate({ profiles: PROFILES, profileOrder: ["default", "work"], windows: {}, tabs: {} });

test("profiles sharing one engine profile: the last active one gets the links", () => {
  S().hydrate({
    profiles: { ...PROFILES, side: { id: "side", name: "Side", color: "green", icon: null, createdAt: 0, dataId: "work" } },
    profileOrder: ["default", "work", "side"],
    windows: {},
    tabs: {},
    lastProfileId: "side",
  });
  const config = linkRoutingConfig(S());
  assert.equal(config.recent, "side");
  assert.deepEqual(config.profiles, { default: "", work: "work", side: "work" });
});
