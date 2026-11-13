import assert from "node:assert/strict";
import { test } from "node:test";
import { startedThisLaunch, watchDownloads } from "../../../../packages/expo-windows/src/engine/domains/downloads.ts";
import { noteDownloadsPanelClose, noteDownloadsPanelOpen, noteDownloadsPanelToggle, takeDownloadsPanelCounts } from "../state/telemetry/downloadsPanelCounts.ts";

const LAUNCH = 1_800_000_000_000;

test("a download Chromium remembers from an earlier launch is not announced again; one running or started since launch is", () => {
  assert.equal(startedThisLaunch({ state: "finished", startTime: LAUNCH - 60_000 }, LAUNCH), false);
  assert.equal(startedThisLaunch({ state: "cancelled", startTime: LAUNCH - 1 }, LAUNCH), false);
  assert.equal(startedThisLaunch({ state: "finished" }, LAUNCH), false);
  assert.equal(startedThisLaunch({ state: "finished", startTime: LAUNCH + 5 }, LAUNCH), true);
  assert.equal(startedThisLaunch({ state: "downloading", startTime: LAUNCH - 60_000 }, LAUNCH), true);
});

test("the launch replay announces only this launch's downloads, with their profile", async () => {
  const emitted = [];
  const engine = {
    call: async () => JSON.stringify({ downloads: [
      { id: "old", state: "finished", startTime: 1 },
      { id: "running", state: "downloading", startTime: 2 },
      { id: "fresh", state: "finished", startTime: Date.now() + 60_000 },
    ] }),
    emit: (name, data) => emitted.push({ name, id: data.id, profile: data.profile }),
  };
  await watchDownloads(engine, "Ardia p-1");
  assert.deepEqual(emitted, [
    { name: "downloads.changed", id: "running", profile: "Ardia p-1" },
    { name: "downloads.changed", id: "fresh", profile: "Ardia p-1" },
  ]);
});

test("downloads panel opens and closes are counted by cause and reset once taken", () => {
  takeDownloadsPanelCounts();
  noteDownloadsPanelOpen("download");
  noteDownloadsPanelToggle(true, "button");
  noteDownloadsPanelToggle(false, "command");
  noteDownloadsPanelClose("outside");
  noteDownloadsPanelClose("escape");
  assert.deepEqual(takeDownloadsPanelCounts(), {
    downloads_panel_opens_download: 1,
    downloads_panel_opens_button: 1,
    downloads_panel_opens_command: 0,
    downloads_panel_closes_escape: 1,
    downloads_panel_closes_outside: 1,
    downloads_panel_closes_button: 0,
    downloads_panel_closes_command: 1,
  });
  assert.equal(Object.values(takeDownloadsPanelCounts()).reduce((a, b) => a + b, 0), 0);
});
