import assert from "node:assert/strict";
import { test } from "node:test";
const { downloadsButtonMenuItems, downloadSettingsProfile } = await import("./downloadsButtonMenu.ts");
const { incognitoProfileId } = await import("../browser/model.ts");

const G = { control: "⌃", option: "⌥", shift: "⇧", command: "⌘" };
const keys = (i) => (i.key ? ["control", "option", "shift", "command"].filter((m) => i.modifiers?.includes(m)).map((m) => G[m]).join("") + i.key.toUpperCase() : "");
const render = (items) => items.map((i) => (i.separator ? "---" : [i.title, keys(i), i.symbol ? `[${i.symbol}]` : "", i.enabled === false ? "(off)" : ""].filter(Boolean).join(" ")));

const shortcut = { key: "j", modifiers: ["shift", "command"] };

test("the Downloads button's own menu: the panel with its shortcut, the Downloads page, the folder, then Clear Downloads last", () => {
  assert.deepEqual(render(downloadsButtonMenuItems({ panelOpen: false, clearable: true, shortcut })), [
    "Show Downloads ⇧⌘J [list.bullet.rectangle]",
    "Show All Downloads [arrow.down.circle]",
    "Open Downloads Folder [folder]",
    "---",
    "Clear Downloads [minus.circle]",
  ]);
});

test("with the panel open the first item hides it, and with only running downloads Clear Downloads is off, as the panel hides its Clear", () => {
  const items = render(downloadsButtonMenuItems({ panelOpen: true, clearable: false }));
  assert.equal(items[0], "Hide Downloads [list.bullet.rectangle]");
  assert.equal(items.at(-1), "Clear Downloads [minus.circle] (off)");
});

test("Open Downloads Folder in a private window reads its own profile's folder, since the engine keeps no settings for a private one", () => {
  const s = { profiles: { work: { id: "work", dataId: "work-data" } } };
  assert.equal(downloadSettingsProfile(s, "work"), "work-data");
  assert.equal(downloadSettingsProfile(s, "default"), "");
  assert.equal(downloadSettingsProfile(s, incognitoProfileId("w1", "work")), "work-data");
});
