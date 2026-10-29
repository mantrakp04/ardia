import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { SYNC_WORDING, rewordSync, syncWording } from "../syncWording.ts";

const shared = (path) => fileURLToPath(new URL(`../../browser/src/${path}`, import.meta.url));
const read = (path) => readFileSync(shared(path), "utf8");
const reworded = (path) => rewordSync(shared(path), read(path));
const MACOS = /\bMacs?\b|iCloud Drive|iCloud Settings|in Finder|iPhone|Universal Clipboard|Keychain|x-apple\.|\bUsers\b/;
const PANES = ["components/settings/panes/Sync.tsx", "components/settings/panes/SyncSheets.tsx"];

test("the shared Sync pane and its sheets read as Linux, with no Mac, iCloud, Finder, iPhone or Keychain wording", () => {
  for (const path of PANES) {
    assert.match(read(path), MACOS, path);
    assert.doesNotMatch(reworded(path), MACOS, path);
  }
  const pane = reworded("components/settings/panes/Sync.tsx");
  assert.match(pane, /across your computers/);
  assert.match(pane, /Syncthing, Nextcloud or Dropbox/);
  assert.match(pane, /your devices meet in the sync folder/);
  assert.match(pane, /title: "Open Sync Folder"/);
  assert.match(pane, /<Button title="Choose…" onPress=\{\(\) => void chooseSyncFolder\(\)\} \/>\n {10}<\/Row>/);
  assert.doesNotMatch(pane, /Linking\.openURL/);
  const sheets = reworded("components/settings/panes/SyncSheets.tsx");
  assert.match(sheets, /title="Add to This Computer"/);
  assert.match(sheets, /This Computer Is Syncing/);
  assert.match(sheets, /system keyring/);
  assert.match(sheets, /your phone’s camera/);
  assert.match(sheets, /On your other device, open Ardia › Settings › Sync/);
  assert.match(sheets, /fontFamily: "monospace"/);
  assert.doesNotMatch(sheets, /fontFamily: "Menlo"/);
  assert.ok(sheets.includes('return folder.path.replace(/^\\/home\\/[^/]+(?=\\/|$)/, "~");'));
});

test("the Recovery Kit sheet offers only the kit actions Linux has: save as text, no PDF, preview, copy or share", () => {
  const original = read("components/settings/panes/SyncSheets.tsx");
  for (const call of ["recoveryKitPreview(", "copyRecoveryKit()", "shareRecoveryKit()", 'save("pdf")']) assert.ok(original.includes(call), call);
  const sheets = reworded("components/settings/panes/SyncSheets.tsx");
  for (const call of ["recoveryKitPreview(", "copyRecoveryKit()", "shareRecoveryKit()", 'save("pdf")', 'accessibilityLabel="Recovery kit preview"', 'title="Other Options"'])
    assert.equal(sheets.includes(call), false, call);
  assert.match(sheets, /<Button title="Save as Text…" kind="primary" onPress=\{\(\) => void save\("text"\)\} \/>/);
  assert.match(sheets, /Your Recovery Kit is a text file/);
  assert.match(sheets, /<Button title="Show Words"|title=\{words \? "Hide Words" : "Show Words"\}/);
  assert.match(sheets, /<Button title="Copy Words" onPress=\{\(\) => void copyRecoveryPhrase\(\)\} \/>/);
});

test("the sync search rows, data types and engine status read as Linux", () => {
  const rows = reworded("components/settings/rows/generalRows.ts");
  const section = (text) => text.slice(text.indexOf("  sync: ["), text.indexOf("  tabs: ["));
  assert.match(section(read("components/settings/rows/generalRows.ts")), /\bMacs\b|icloud/);
  assert.doesNotMatch(section(rows), /\bMacs?\b|icloud/i);
  assert.match(section(rows), /across your computers/);
  assert.match(reworded("state/sync/syncDoc.ts"), /never removes them from this computer/);
  assert.match(reworded("state/sync/engine.ts"), /keep syncing on this device/);
  assert.match(reworded("state/sync/engine.ts"), /Couldn’t save the sync key in your Keychain\./);
});

test("every sync replacement still matches the shared source, so a copy change fails the Linux build", () => {
  for (const { file, replacements } of SYNC_WORDING) {
    const source = read(file);
    for (const [from] of replacements) assert.ok(source.includes(from), `${file} no longer contains ${JSON.stringify(from.slice(0, 60))}`);
  }
  assert.throws(() => rewordSync(shared("components/settings/panes/Sync.tsx"), "export const nothing = 1;"), /no longer contains.*syncWording\.ts/);
  assert.equal(rewordSync(shared("components/settings/panes/General.tsx"), "const x = 'Mac';"), null);
});

test("the Linux Vite config runs the sync wording transform and a build fails when a listed file was never reworded", () => {
  const config = readFileSync(fileURLToPath(new URL("../vite.config.ts", import.meta.url)), "utf8");
  assert.match(config, /import \{ syncWording \} from "\.\/syncWording";/);
  assert.match(config, /plugins: \[[^\]]*syncWording\(\)/);
  const context = { error(message) { throw new Error(message); } };
  const run = (files, modules = files.map(shared)) => {
    const plugin = syncWording();
    plugin.configResolved({ command: "build" });
    for (const file of files) plugin.transform.call(context, read(file), shared(file));
    return () => plugin.buildEnd.call({ ...context, getModuleIds: () => [...modules].values() });
  };
  const all = SYNC_WORDING.map((entry) => entry.file);
  assert.doesNotThrow(run(all));
  assert.throws(run(all.filter((file) => !file.endsWith("SyncSheets.tsx"))), /syncWording\.ts never reworded .*panes\/SyncSheets\.tsx/);
});
