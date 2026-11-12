import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
globalThis.require = createRequire(import.meta.url);

const KEY_FAILED = "The Google Chrome key didn't decrypt any passwords";
const link = (title, url) => ({ type: "url", title, url });

globalThis.acTestNativeModules = {
  ArdiaImport: {
    addListener: () => ({ remove() {} }),
    isBrowserUnlocked: () => true,
    forgetUnlockedKeys() {},
    cancelImport() {},
    listExtensions: async () => "[]",
    importData: async (_job, browserId, profileId) =>
      JSON.stringify({
        browserId, profileId, history: [], historyCount: 0, tabs: [], tabGroups: [], credentials: [], cookieCount: 0, addressCount: 0, cardCount: 0,
        spaces: [], favorites: [], favicons: [],
        bookmarks: { type: "folder", title: "Bookmarks", children: [{ type: "folder", title: "Bookmarks Bar", role: "toolbar", children: [link(profileId, `https://${profileId.replace(" ", "")}.example/`)] }] },
        failed: ["passwords"],
        warnings: [
          { kind: "passwords", code: "undecryptable", message: "2 passwords couldn't be decrypted" },
          { kind: "passwords", code: "locked", message: KEY_FAILED },
        ],
      }),
  },
};

const { useBrowser } = await import("../browser/store.ts");
const { useImportFlow } = await import("./flow.ts");
const { runImport } = await import("./runImport.ts");

test("on the Mac, two Chrome profiles whose key decrypted nothing show the failure once and its reason once", async () => {
  useBrowser.setState({ bookmarks: { nodes: {} } });
  useBrowser.getState().hydrate({});
  useBrowser.getState().createWindow({ url: "https://start.example/" });
  const profile = (id) => ({ id, name: id, path: id, isDefault: id === "Default", available: ["bookmarks", "passwords"] });
  useImportFlow.setState({
    source: { id: "chrome", name: "Google Chrome", family: "chromium", requiresExport: false, needsKeychain: true, profiles: [profile("Default"), profile("Profile 1")] },
    sourceProfiles: ["Default", "Profile 1"],
    spaces: [],
    target: "default",
    kinds: new Set(["bookmarks", "passwords"]),
    step: { name: "choose", error: null },
  });
  await runImport(new Set(["bookmarks", "passwords"]));
  await new Promise((r) => setTimeout(r, 5));
  const step = useImportFlow.getState().step;
  assert.equal(step.name, "done");
  assert.deepEqual(step.failures, [{ kind: "passwords", profiles: ["Default", "Profile 1"] }]);
  assert.deepEqual(step.notes, [`${KEY_FAILED}.`]);
  assert.equal(step.counts.bookmarks, 2);
});
