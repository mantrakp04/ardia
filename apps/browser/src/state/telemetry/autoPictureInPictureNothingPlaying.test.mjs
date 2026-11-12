import assert from "node:assert/strict";
import { after, test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");
const usage = await import("./usage.ts");
after(() => client.setSharing(false, "settings"));

async function sentUsageCounts() {
  await client.saveQueueNow();
  const saved = JSON.parse(stub.docs.get("telemetry-queue.json") ?? '{"events":[]}');
  return saved.events
    .filter((e) => e.event === "usage_counts")
    .map((e) => ({ kept: e.properties.auto_pip_kept_visible, appSwitch: e.properties.auto_pip_stayed_on_app_switch, nothingPlaying: e.properties.auto_pip_nothing_playing }));
}

test("an automatic Picture in Picture held back because nothing played is sent once with the session's counts, then starts again from zero", async () => {
  client.loadChoice();
  client.setSharing(true, "onboarding");

  usage.noteAutoPictureInPictureKept("nothingPlaying");
  usage.noteAutoPictureInPictureKept("nothingPlaying");
  usage.noteAutoPictureInPictureKept("nothingPlaying");
  usage.sessionEnding();
  assert.deepEqual(await sentUsageCounts(), [{ kept: 0, appSwitch: 0, nothingPlaying: 3 }]);

  usage.sessionEnding();
  assert.deepEqual(await sentUsageCounts(), [{ kept: 0, appSwitch: 0, nothingPlaying: 3 }]);

  usage.noteAutoPictureInPictureKept("onScreen");
  usage.noteAutoPictureInPictureKept("appSwitch");
  usage.noteAutoPictureInPictureKept("appSwitch");
  usage.sessionEnding();
  assert.deepEqual(await sentUsageCounts(), [
    { kept: 0, appSwitch: 0, nothingPlaying: 3 },
    { kept: 1, appSwitch: 2, nothingPlaying: 0 },
  ]);
});
