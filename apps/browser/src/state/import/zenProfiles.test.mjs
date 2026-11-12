import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
globalThis.require = createRequire(import.meta.url);

const link = (url) => ({ type: "url", title: url.split("/").at(-1), url });
const folder = (title, urls) => ({ type: "folder", title, children: urls.map(link) });
const essential = (url, container) => ({ url, title: url, pinned: true, windowIndex: 0, active: false, ...(container ? { container } : {}) });
const space = (id, name, container, pinned) => ({ id, name, profileId: "", pinned, tabs: [], ...(container ? { container } : {}) });

const ZEN = {
  "Profiles/a.Personal": {
    separateEssentials: true,
    spaces: [
      space("work", "Work", 1, [link("https://work.example/pin")]),
      space("home", "Home", 0, [link("https://home.example/pin-1"), link("https://home.example/pin-2"), folder("Reading", ["https://home.example/read"])]),
      space("money", "Money", 2, [link("https://bank.example/pin")]),
      space("side", "Side", 0, [link("https://side.example/pin")]),
    ],
    favorites: [essential("https://mail.example/"), essential("https://chat.example/", 1), essential("https://bank.example/", 2), essential("https://gone.example/", 7)],
  },
  "Profiles/b.School": {
    spaces: [space("study", "Study", 0, [link("https://study.example/pin")]), space("lab", "Research", 1, [link("https://lab.example/pin")])],
    favorites: [essential("https://study.example/"), essential("https://lab.example/", 1)],
  },
};

let zen = ZEN;
globalThis.acTestNativeModules = {
  ArdiaImport: {
    addListener: () => ({ remove() {} }),
    isBrowserUnlocked: () => true,
    forgetUnlockedKeys() {},
    cancelImport() {},
    listExtensions: async () => "[]",
    importData: async (_job, browserId, profileId, kinds, options) => {
      const p = zen[profileId];
      const spaces = p.spaces.filter((s) => !options.spaceIds || options.spaceIds.includes(s.id)).map((s) => ({ ...s, profileId }));
      return JSON.stringify({
        browserId, profileId, history: [], historyCount: 0, tabs: [], tabGroups: [], credentials: [], cookieCount: 0, addressCount: 0, cardCount: 0,
        spaces, favorites: kinds.includes("favorites") ? p.favorites : [], favicons: [], failed: [], warnings: [],
        ...(p.separateEssentials === undefined ? {} : { separateEssentials: p.separateEssentials }),
      });
    },
  },
};

const { useBrowser } = await import("../browser/store.ts");
const { useImportFlow } = await import("./flow.ts");
const { runImport } = await import("./runImport.ts");
const { dataIdOf } = await import("../profiles/profiles.ts");

const S = () => useBrowser.getState();
const source = (profiles) => ({
  id: "zen", name: "Zen", family: "firefox", sidebar: "zen", requiresExport: false, needsKeychain: false,
  profiles: profiles.map((id) => ({ id, name: id.split(".")[1], path: id, isDefault: id.startsWith("Profiles/a"), available: [], spaces: zen[id].spaces.map((s) => ({ ...s, pinnedCount: 1, tabCount: 0 })) })),
});

async function importZen(profiles, spaces) {
  useBrowser.setState({ bookmarks: { nodes: {} } });
  S().hydrate({});
  S().createWindow({ url: "https://start.example/" });
  useImportFlow.setState({ source: source(profiles), sourceProfiles: profiles, spaces, target: "default", kinds: new Set(["tabs", "favorites"]), step: { name: "choose", error: null } });
  await runImport(new Set(["tabs", "favorites"]));
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(useImportFlow.getState().step.name, "done");
}

const named = (name) => S().profileOrder.find((id) => S().profiles[id].name === name);
const pinsOf = (profileId, as) =>
  Object.values(S().tabs)
    .filter((t) => t.profileId === profileId && t.pin?.as === as)
    .map((t) => t.pinnedUrl)
    .sort();
const rowsOf = (name) => pinsOf(named(name) ?? "default", "row");
const tilesOf = (name) => pinsOf(named(name) ?? "default", "tile");
const groupLinks = (name) =>
  Object.values(S().groups)
    .filter((g) => g.pinned && g.profileId === (named(name) ?? "default"))
    .flatMap((g) => g.tabIds.map((id) => S().tabs[id].pinnedUrl ?? S().tabs[id].url));
const dataOf = (name) => dataIdOf(S().profiles[named(name) ?? "default"]);

const ALL = ["work", "home", "money", "side", "study", "lab"];

test("each Zen profile's spaces land in their own Ardia profiles, never all in the first one", async () => {
  await importZen(Object.keys(ZEN), ALL);
  assert.deepEqual(
    S().profileOrder.map((id) => S().profiles[id].name),
    [S().profiles.default.name, "Work", "Money", "Side", "Study", "Research"],
  );
  assert.deepEqual(rowsOf(S().profiles.default.name), ["https://home.example/pin-1", "https://home.example/pin-2"], "Home went into the target");
  assert.deepEqual(groupLinks(S().profiles.default.name), ["https://home.example/read"], "with its folder");
  assert.deepEqual(rowsOf("Work"), ["https://work.example/pin"]);
  assert.deepEqual(rowsOf("Money"), ["https://bank.example/pin"]);
  assert.deepEqual(rowsOf("Side"), ["https://side.example/pin"]);
  assert.deepEqual(rowsOf("Study"), ["https://study.example/pin"]);
  assert.deepEqual(rowsOf("Research"), ["https://lab.example/pin"]);
});

test("a space shares data with the spaces of its own Zen profile and container only", async () => {
  await importZen(Object.keys(ZEN), ALL);
  const home = dataIdOf(S().profiles.default);
  assert.equal(dataOf("Side"), home, "Side is in Home's container");
  for (const apart of ["Work", "Money", "Study", "Research"]) assert.notEqual(dataOf(apart), home, `${apart} keeps its own data`);
  assert.notEqual(dataOf("Study"), dataOf("Research"), "School's container space is apart from School's default one");
  assert.notEqual(dataOf("Work"), dataOf("Research"), "container 1 of one Zen profile is not container 1 of another");
});

test("Essentials follow their container, and every space of that container shows them", async () => {
  await importZen(Object.keys(ZEN), ALL);
  const home = S().profiles.default.name;
  assert.deepEqual(tilesOf(home), ["https://gone.example/", "https://mail.example/"], "a container with no space falls back to the default one");
  assert.deepEqual(tilesOf("Side"), ["https://gone.example/", "https://mail.example/"]);
  assert.deepEqual(tilesOf("Work"), ["https://chat.example/"]);
  assert.deepEqual(tilesOf("Money"), ["https://bank.example/"]);
  assert.deepEqual(tilesOf("Study"), ["https://study.example/"]);
  assert.deepEqual(tilesOf("Research"), ["https://lab.example/"]);
});

test("the later spaces of one container share its data and Top Apps", async () => {
  zen = { "Profiles/b.School": { spaces: [space("lab", "Research", 1, []), space("lab2", "Lab notes", 1, [])], favorites: [essential("https://lab.example/", 1)] } };
  await importZen(["Profiles/b.School"], ["lab", "lab2"]);
  zen = ZEN;
  assert.ok(S().profiles[named("Lab notes")].shareTopApps);
  assert.equal(dataOf("Lab notes"), dataIdOf(S().profiles.default));
});

test("with Essentials shared across containers in Zen, every container gets them", async () => {
  zen = { "Profiles/a.Personal": { ...ZEN["Profiles/a.Personal"], separateEssentials: false } };
  await importZen(["Profiles/a.Personal"], ["work", "home", "money", "side"]);
  zen = ZEN;
  const all = ["https://bank.example/", "https://chat.example/", "https://gone.example/", "https://mail.example/"];
  assert.deepEqual(tilesOf("Work"), all);
  assert.deepEqual(tilesOf("Money"), all);
  assert.deepEqual(tilesOf(S().profiles.default.name), all);
});

test("Essentials go to the chosen spaces of their container, and a container left out keeps its own", async () => {
  await importZen(["Profiles/a.Personal"], ["side"]);
  assert.deepEqual(rowsOf(S().profiles.default.name), ["https://side.example/pin"], "Side, Home's container mate, became the target");
  assert.deepEqual(tilesOf(S().profiles.default.name), ["https://gone.example/", "https://mail.example/"]);
  assert.equal(named("Work"), undefined);
  assert.ok(!Object.values(S().tabs).some((t) => t.pinnedUrl === "https://chat.example/"), "a container with no chosen space doesn't spill into another");
});
