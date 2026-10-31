import assert from "node:assert/strict";
import { test } from "node:test";

const { DEFAULT_LINK_ROUTING, LITTLE_ARDIA, RECENT, normalizeLinkRouting, placeExternalLink, placeLinkFrom, routeMatches, withRouteMoved } = await import("./linkRouting.ts");

const route = (id, match, pattern, destination) => ({ id, match, pattern, destination });
const work = { kind: "profile", profileId: "work" };
const home = { kind: "profile", profileId: "home" };
const inbox = { kind: "group", profileId: "work", groupKey: "g-inbox" };

const world = {
  recentProfileId: "home",
  hasProfile: (id) => id === "home" || id === "work",
  hasGroup: (profileId, key) => profileId === "work" && key === "g-inbox",
};

test("contains matches anywhere in the URL, case-insensitively, and never a non-web URL", () => {
  const r = route("r", "contains", "GitHub.com", work);
  assert.equal(routeMatches(r, "https://github.com/mantrakp04/ardia"), true);
  assert.equal(routeMatches(r, "https://example.com/?next=https://github.com/x"), true);
  assert.equal(routeMatches(r, "https://gitlab.com/x"), false);
  assert.equal(routeMatches(r, "file:///Users/me/github.com.html"), false);
  assert.equal(routeMatches(route("r", "contains", "   ", work), "https://github.com"), false);
});

test("is equal to ignores the scheme, query, fragment, case and one trailing slash", () => {
  const r = route("r", "equals", "https://Linear.app/team/", work);
  assert.equal(routeMatches(r, "http://linear.app/team"), true);
  assert.equal(routeMatches(r, "https://linear.app/team/?utm=1#top"), true);
  assert.equal(routeMatches(r, "https://linear.app/team/issue-1"), false);
  assert.equal(routeMatches(r, "https://www.linear.app/team"), false);
  assert.equal(routeMatches(route("r", "equals", "x.com", work), "https://x.com/"), true);
});

test("links from other apps take the first matching route, skipping routes whose destination is gone, else the default", () => {
  const routing = {
    routes: [route("a", "contains", "x.com", { kind: "profile", profileId: "deleted" }), route("b", "contains", "x.com", inbox), route("c", "contains", ".com", work)],
    defaultDestination: LITTLE_ARDIA,
  };
  assert.deepEqual(placeExternalLink(routing, "https://x.com/a", world), { kind: "group", profileId: "work", groupKey: "g-inbox" });
  assert.deepEqual(placeExternalLink(routing, "https://ardia.com", world), { kind: "profile", profileId: "work" });
  assert.deepEqual(placeExternalLink(routing, "https://ardia.io", world), { kind: "little", profileId: "home" });
  assert.deepEqual(placeExternalLink({ routes: [], defaultDestination: RECENT }, "https://ardia.io", world), { kind: "profile", profileId: "home" });
  assert.deepEqual(placeExternalLink({ routes: [], defaultDestination: { kind: "profile", profileId: "deleted" } }, "https://ardia.io", world), {
    kind: "profile",
    profileId: "home",
  });
});

test("a link from a page or the address bar routes only to another place; Little Ardia keeps the source profile", () => {
  const routing = { routes: [route("a", "contains", "x.com", home), route("b", "contains", "y.com", inbox), route("c", "contains", "z.com", LITTLE_ARDIA)], defaultDestination: work };
  assert.equal(placeLinkFrom(routing, "https://x.com", world, "home"), null);
  assert.deepEqual(placeLinkFrom(routing, "https://x.com", world, "work"), { kind: "profile", profileId: "home" });
  assert.deepEqual(placeLinkFrom(routing, "https://y.com", world, "work"), { kind: "group", profileId: "work", groupKey: "g-inbox" });
  assert.deepEqual(placeLinkFrom(routing, "https://z.com", world, "work"), { kind: "little", profileId: "work" });
  assert.equal(placeLinkFrom(routing, "https://nothing.dev", world, "home"), null);
  assert.equal(placeLinkFrom({ routes: [route("r", "contains", "x.com", RECENT)], defaultDestination: work }, "https://x.com", world, "home"), null);
});

test("saved routing is normalized: malformed routes and duplicate ids drop, an unknown default becomes Little Ardia", () => {
  assert.deepEqual(normalizeLinkRouting(undefined), DEFAULT_LINK_ROUTING);
  assert.deepEqual(normalizeLinkRouting({ routes: "nope", defaultDestination: { kind: "space" } }), DEFAULT_LINK_ROUTING);
  const saved = {
    routes: [
      route("a", "contains", "x.com", work),
      route("a", "equals", "dup", work),
      route("b", "regex", "x", work),
      { id: "c", match: "contains", pattern: "y", destination: { kind: "group", profileId: "work" } },
      route("d", "equals", "", { kind: "recent", extra: 1 }),
    ],
    defaultDestination: { kind: "profile", profileId: "work" },
  };
  assert.deepEqual(normalizeLinkRouting(saved), {
    routes: [route("a", "contains", "x.com", work), route("d", "equals", "", RECENT)],
    defaultDestination: work,
  });
});

test("moving a route swaps it with its neighbour and stops at the ends", () => {
  const routing = { routes: [route("a", "contains", "a", work), route("b", "contains", "b", work)], defaultDestination: RECENT };
  assert.deepEqual(withRouteMoved(routing, "b", -1).routes.map((r) => r.id), ["b", "a"]);
  assert.equal(withRouteMoved(routing, "a", -1), routing);
  assert.equal(withRouteMoved(routing, "b", 1), routing);
});

const { useBrowser } = await import("../state/browser/store.ts");
const { pageLinkRoutes } = await import("../state/linkRouting/placement.ts");
const { sessionWithLinkRouting } = await import("../state/settings/settings.ts");
const S = () => useBrowser.getState();

test("the old Little Ardia switch migrates: off becomes a Most Recent default, on or missing stays Little Ardia, a saved routing wins", () => {
  const off = sessionWithLinkRouting({ settings: { openLinksInLittleArdia: false, appearance: "dark" }, settingsMeta: { chosen: ["openLinksInLittleArdia", "appearance"], inferred: ["openLinksInLittleArdia"] } });
  assert.deepEqual(off.settings, { appearance: "dark", linkRouting: { routes: [], defaultDestination: RECENT } });
  assert.deepEqual(off.settingsMeta, { chosen: ["appearance", "linkRouting"], inferred: [] });

  const on = sessionWithLinkRouting({ settings: { openLinksInLittleArdia: true }, settingsMeta: { chosen: ["openLinksInLittleArdia"], inferred: [] } });
  assert.deepEqual(on.settings, {});
  assert.deepEqual(on.settingsMeta, { chosen: ["linkRouting"], inferred: [] });
  S().hydrate({ settings: on.settings, settingsMeta: on.settingsMeta });
  assert.deepEqual(S().settings.linkRouting, DEFAULT_LINK_ROUTING);

  const untouched = { settings: { appearance: "dark" }, settingsMeta: { chosen: [], inferred: [] } };
  assert.equal(sessionWithLinkRouting(untouched), untouched);

  const saved = { routes: [route("a", "contains", "x.com", { kind: "profile", profileId: "default" })], defaultDestination: RECENT };
  const both = sessionWithLinkRouting({ settings: { openLinksInLittleArdia: true, linkRouting: { ...saved, routes: [...saved.routes, { id: "broken" }] } }, settingsMeta: { chosen: ["linkRouting"], inferred: [] } });
  assert.deepEqual(both.settings, { linkRouting: saved });
  assert.deepEqual(both.settingsMeta, { chosen: ["linkRouting"], inferred: [] });
});

test("pages get the routes they can match on their own: patterns normalized, destinations reduced to a profile or none, dead routes left out", () => {
  S().hydrate({
    profiles: { default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 }, work: { id: "work", name: "Work", color: "blue", icon: null, createdAt: 0 } },
    profileOrder: ["default", "work"],
    windows: {},
    tabs: {},
    settings: {
      linkRouting: {
        routes: [
          route("a", "contains", "  GitHub.com ", work),
          route("b", "equals", "https://Linear.app/team/?x#y", RECENT),
          route("c", "contains", "z.com", LITTLE_ARDIA),
          route("d", "contains", "gone.com", { kind: "profile", profileId: "gone" }),
          route("e", "contains", "", work),
        ],
        defaultDestination: RECENT,
      },
    },
  });
  assert.deepEqual(pageLinkRoutes(S()), [
    { match: "contains", pattern: "github.com", profile: "work" },
    { match: "equals", pattern: "linear.app/team", profile: "default" },
    { match: "contains", pattern: "z.com", profile: null },
  ]);
});

test("a link clicked inside its destination group or Little Ardia window is not a route, elsewhere it is", async () => {
  const { placeLinkFromProfile } = await import("../state/linkRouting/placement.ts");
  const inboxRoute = route("r", "contains", "mail.example", { kind: "group", profileId: "home", groupKey: "pin-inbox" });
  const littleRoute = route("l", "contains", "chat.example", { kind: "little" });
  const s = {
    profiles: { home: { id: "home" } },
    profileOrder: ["home"],
    settings: { defaultProfileId: "home", linkRouting: { routes: [inboxRoute, littleRoute], defaultDestination: RECENT } },
    groups: { g1: { id: "g1", profileId: "home", pinKey: "pin-inbox", windowId: "w1", tabIds: ["t-in"] } },
    parkedPins: {},
    windows: { w1: { id: "w1", profileId: "home", kind: "main" }, small: { id: "small", profileId: "home", kind: "small" } },
    windowOrder: ["w1"],
    ui: { lastProfileId: "home", focusOrder: ["w1"] },
  };
  assert.equal(placeLinkFromProfile(s, "https://mail.example/", "home", { windowId: "w1", tabId: "t-in" }), null);
  assert.deepEqual(placeLinkFromProfile(s, "https://mail.example/", "home", { windowId: "w1", tabId: "t-out" }), { kind: "group", profileId: "home", groupKey: "pin-inbox" });
  assert.equal(placeLinkFromProfile(s, "https://chat.example/", "home", { windowId: "small" }), null);
  assert.deepEqual(placeLinkFromProfile(s, "https://chat.example/", "home", { windowId: "w1" }), { kind: "little", profileId: "home" });
});
