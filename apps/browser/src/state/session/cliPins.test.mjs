import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { useBrowser } from "../browser/store.ts";
import { flushPersistence, startPersistence } from "./persist.ts";
import { docs } from "../../test-native/index.ts";

test("CLI pins read production v10 sessions across loaded, sleeping and parked pages", () => {
  docs.clear();
  const stop = startPersistence();
  const directory = mkdtempSync(join(tmpdir(), "ardia-cli-pins-"));
  const S = () => useBrowser.getState();
  const python = process.env.ARDIA_CLI_TEST_PYTHON || "python3";
  const read = () => {
    flushPersistence();
    const json = docs.get("session.json");
    assert.equal(JSON.parse(json).version, 10);
    writeFileSync(join(directory, "session.json"), json);
    let rows;
    try { rows = execFileSync(python, ["-c", `
import json, sys
if sys.version_info < (3, 10):
    raise SystemExit('Python 3.10 or newer is required for the CLI session test.')
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, sys.argv[1])
from ardia_cli import browsing
root = Path(sys.argv[2])
with patch.object(browsing, 'checked_root', return_value=root):
    print(json.dumps(browsing.pinned(root)))
`, fileURLToPath(new URL("../../../../cli/", import.meta.url)), directory], { encoding: "utf8", timeout: 10000 }); }
    catch (error) { throw new Error("CLI session test needs Python 3.10 or newer. Set ARDIA_CLI_TEST_PYTHON to that interpreter.", { cause: error }); }
    return JSON.parse(rows);
  };
  try {
    const window = S().createWindow({ url: "https://mail.test/" });
    const tile = S().windows[window].tabIds[0];
    S().pinTabs([tile], true);
    const school = S().createSpace({ name: "School", profileId: "default" });
    const row = S().newTab(window, { spaceId: school, url: "https://notes.test/" });
    S().pinTabs([row], true, true);
    const members = [1, 2].map((n) => S().newTab(window, { spaceId: school, url: `https://folder.test/${n}` }));
    const group = S().createGroup(members, { name: "School Folder" });
    S().updateGroup(group, { pinned: true });
    S().createWindow({ spaceId: school });
    const work = S().createProfile({ name: "Work" });
    S().updateProfile("default", { name: "Personal" });
    useBrowser.setState({ topApps: { ...S().topApps, [work]: [{ ...S().topApps.default[0], url: "https://work.test/" }] } });
    const loaded = read();
    assert.equal(loaded.length, 5);
    assert.deepEqual(loaded.filter((r) => r.kind === "favorite").map((r) => [r.profile, r.space, r.parked]), [["Personal", null, false], ["Work", null, true]]);
    assert.deepEqual(loaded.filter((r) => r.kind === "pinned").map((r) => [r.profile, r.space, r.folder]), [["Personal", "School", null], ["Personal", "School", "School Folder"], ["Personal", "School", "School Folder"]]);
    useBrowser.setState({ tabs: Object.fromEntries(Object.entries(S().tabs).map(([id, tab]) => [id, tab.pin?.as === "tile" ? { ...tab, page: { kind: "asleep" } } : tab])) });
    assert.ok(read().filter((r) => r.kind === "favorite").every((r) => r.parked));
    for (const id of [...S().windowOrder]) S().closeWindow(id);
    const parked = read();
    assert.equal(parked.length, 5);
    assert.ok(parked.every((r) => r.parked));
  } finally { stop(); rmSync(directory, { recursive: true, force: true }); }
});
