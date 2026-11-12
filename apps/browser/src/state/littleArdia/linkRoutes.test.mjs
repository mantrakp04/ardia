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
S().hydrate({ profiles: PROFILES, profileOrder: ["default", "work"], windows: {}, tabs: {} });

test("links native parked open in the profile it parked them in, each marked for its own page", () => {
  assert.deepEqual(routedLinks({ profile: "work", adoptIds: ["link:0", null, "link:2"] }, 3), { profileId: "work", adoptIds: ["link:0", undefined, "link:2"] });
  assert.deepEqual(routedLinks({ profile: "", adoptIds: ["link:1"] }, 1), { profileId: "default", adoptIds: ["link:1"] });
});

test("nothing parked, or a profile JS doesn't know: no marks, JS picks the profile as before", () => {
  assert.deepEqual(routedLinks({}, 2), { profileId: null, adoptIds: [undefined, undefined] });
  assert.deepEqual(routedLinks({ profile: "gone", adoptIds: ["link:0"] }, 1), { profileId: null, adoptIds: [undefined] });
});

test("profiles sharing one engine profile: the last active one gets the links", () => {
  S().hydrate({
    profiles: { ...PROFILES, side: { id: "side", name: "Side", color: "green", icon: null, createdAt: 0, dataId: "work" } },
    profileOrder: ["default", "work", "side"],
    windows: {},
    tabs: {},
    lastProfileId: "side",
  });
  assert.deepEqual(routedLinks({ profile: "work", adoptIds: ["link:0"] }, 1), { profileId: "side", adoptIds: ["link:0"] });
});
