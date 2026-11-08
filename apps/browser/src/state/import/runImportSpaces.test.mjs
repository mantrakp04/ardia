import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { beforeEach, test } from "node:test";
globalThis.require = createRequire(import.meta.url);

let spaces = [];
globalThis.acTestNativeModules = {
  ArdiaImport: {
    addListener: () => ({ remove() {} }),
    cancelImport() {},
    forgetUnlockedKeys() {},
    isBrowserUnlocked: () => true,
    listExtensions: async () => "[]",
    importData: async () =>
      JSON.stringify({
        browserId: "arc",
        profileId: "Default",
        history: [],
        historyCount: 0,
        tabs: [],
        tabGroups: [],
        credentials: [],
        cookieCount: 0,
        addressCount: 0,
        cardCount: 0,
        spaces,
        favorites: [],
        favicons: [],
        failed: [],
        warnings: [],
      }),
  },
};

const { useBrowser } = await import("../browser/store.ts");
const { patchImport } = await import("./flow.ts");
const { runImport } = await import("./runImport.ts");

const S = () => useBrowser.getState();
const space = (id, name, extra = {}) => ({ id, name, profileId: "Default", pinned: [], tabs: [], ...extra });
const named = () => S().profileOrder.map((id) => S().profiles[id].name);

const source = {
  id: "arc",
  name: "Arc",
  family: "arc",
  requiresExport: false,
  needsKeychain: false,
  sidebar: "arc",
  profiles: [{ id: "Default", name: "Default", path: "/arc", isDefault: true, available: ["spaces"], spaces: [] }],
};

function begin(imported, target = "default") {
  useBrowser.setState({ bookmarks: { nodes: {} } });
  S().hydrate({});
  spaces = imported;
  patchImport({ source, sourceProfiles: ["Default"], spaces: imported.map((s) => s.id), target, kinds: new Set(["spaces"]) });
}

beforeEach(() => {
  spaces = [];
});

test("Arc's first space names the untouched starter profile instead of leaving it Personal", async () => {
  begin([space("a", "Work", { emoji: "💼", color: "#2a6ef5" }), space("b", "Home", { emoji: "🏠" })]);
  await runImport(new Set(["spaces"]));
  assert.deepEqual(named(), ["Work", "Home"]);
  assert.equal(S().profiles.default.icon, "💼");
  assert.equal(S().profiles.default.color, "blue");
});

test("a starter profile with no space colour keeps its own colour", async () => {
  begin([space("a", "Work")]);
  await runImport(new Set(["spaces"]));
  assert.deepEqual(named(), ["Work"]);
  assert.equal(S().profiles.default.color, "plum");
  assert.equal(S().profiles.default.icon, null);
});

test("a profile the person renamed before importing keeps its name", async () => {
  begin([space("a", "Work", { emoji: "💼" }), space("b", "Home")]);
  S().updateProfile("default", { name: "Me" });
  await runImport(new Set(["spaces"]));
  assert.deepEqual(named(), ["Me", "Home"]);
  assert.equal(S().profiles.default.icon, null);
});

test("a profile with its own icon keeps its look", async () => {
  begin([space("a", "Work", { emoji: "💼" })]);
  S().updateProfile("default", { icon: "🌱" });
  await runImport(new Set(["spaces"]));
  assert.deepEqual(named(), ["Personal"]);
  assert.equal(S().profiles.default.icon, "🌱");
});

test("a profile picked out of several is not renamed", async () => {
  begin([space("a", "Work"), space("b", "Home")]);
  S().createProfile({ name: "Other" });
  await runImport(new Set(["spaces"]));
  assert.deepEqual(named(), ["Personal", "Other", "Home"]);
});
