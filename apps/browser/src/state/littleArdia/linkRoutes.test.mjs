import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { useBrowser } = await import("../browser/store.ts");
const { routedLinks } = await import("./linkRoutes.ts");

const S = () => useBrowser.getState();
const PROFILES = {
  default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 },
  work: { id: "work", name: "Work", color: "blue", icon: null, createdAt: 0 },
};
S().hydrate({ spaces: PROFILES, spaceOrder: ["default", "work"], windows: {}, tabs: {} });

test("links native parked open in the default Space when the parked browsing identity matches, each marked for its own page", () => {
  S().setDefaultSpace("work");
  assert.deepEqual(routedLinks({ profile: "work", adoptIds: ["link:0", null, "link:2"] }, 3), { spaceId: "work", adoptIds: ["link:0", undefined, "link:2"] });
  S().setDefaultSpace("default");
  assert.deepEqual(routedLinks({ profile: "", adoptIds: ["link:1"] }, 1), { spaceId: "default", adoptIds: ["link:1"] });
});

test("nothing parked, or a space JS doesn't know: no marks, JS picks the space as before", () => {
  assert.deepEqual(routedLinks({}, 2), { spaceId: null, adoptIds: [undefined, undefined] });
  assert.deepEqual(routedLinks({ profile: "gone", adoptIds: ["link:0"] }, 1), { spaceId: "default", adoptIds: [undefined] });
});

test("spaces sharing one engine profile: the default Space gets the links", () => {
  S().hydrate({
    spaces: { ...PROFILES, side: { id: "side", name: "Side", color: "green", icon: null, createdAt: 0, profileId: "work" } },
    spaceOrder: ["default", "work", "side"],
    windows: {},
    tabs: {},
    lastSpaceId: "side",
    settings: { defaultSpaceId: "side" },
  });
  assert.deepEqual(routedLinks({ profile: "work", adoptIds: ["link:0"] }, 1), { spaceId: "side", adoptIds: ["link:0"] });
});
