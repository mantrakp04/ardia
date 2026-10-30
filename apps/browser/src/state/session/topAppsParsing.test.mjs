import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSession } from "./persist.ts";
import { useBrowser } from "../browser/store.ts";

const app = { key: "mail", url: "https://mail.test/", title: "Mail", favicon: null, customTitle: null, customIcon: null };
const saved = (topApps) => JSON.stringify({ version: 10, topApps, profiles: { default: { id: "default", name: "Personal", icon: null, engineId: "", createdAt: 0 } }, spaces: { default: { id: "default", name: "Personal", profileId: "default", color: "plum", icon: null, createdAt: 0 } }, spaceOrder: ["default"] });

test("a damaged Top Apps bucket cannot stop session hydration", () => {
  const session = parseSession(saved({ default: { unexpected: true } }));
  assert.deepEqual(session.topApps.default, []);
  assert.doesNotThrow(() => useBrowser.getState().hydrate(session));
});

test("saved Top Apps keep valid tiles and reject malformed fields and folders", () => {
  const bad = [null, { key: "missing" }, { ...app, url: 7 }, { ...app, title: null }, { ...app, favicon: 3 }, { ...app, customTitle: [] }, { ...app, customIcon: false }, { ...app, tileFolder: { id: "f" } }, { ...app, tileFolder: { id: "f", name: "Folder", renamedAt: "soon" } }];
  const folder = { ...app, key: "folder", tileFolder: { id: "f", name: "Folder", renamedAt: 12 } };
  const session = parseSession(saved({ default: [app, ...bad, folder] }));
  assert.deepEqual(session.topApps.default, [app, folder]);
  assert.doesNotThrow(() => useBrowser.getState().hydrate(session));
});
