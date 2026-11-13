import assert from "node:assert/strict";
import { after, test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");
const usage = await import("./usage.ts");
const backToTab = await import("./pictureInPictureCounts.ts");
after(() => client.setSharing(false, "settings"));

async function sentUsageCounts() {
  await client.saveQueueNow();
  const saved = JSON.parse(stub.docs.get("telemetry-queue.json") ?? '{"events":[]}');
  return saved.events
    .filter((e) => e.event === "usage_counts")
    .map((e) => ({ chromium: e.properties.pip_back_to_tab, webkit: e.properties.pip_back_to_tab_webkit }));
}

test("going back to a tab from its Picture in Picture window is counted per engine, sent on its own, then starts again from zero", async () => {
  client.loadChoice();
  client.setSharing(true, "onboarding");

  backToTab.notePictureInPictureBackToTab("webkit");
  backToTab.notePictureInPictureBackToTab("webkit");
  backToTab.notePictureInPictureBackToTab("chromium");
  usage.sessionEnding();
  assert.deepEqual(await sentUsageCounts(), [{ chromium: 1, webkit: 2 }]);

  usage.sessionEnding();
  assert.equal((await sentUsageCounts()).length, 1);
});

test("Picture in Picture drags are counted with the ones held at an edge and the ones that ended off the grab point, then start again from zero", async () => {
  client.loadChoice();
  client.setSharing(true, "onboarding");
  const sentDrags = async () => {
    await client.saveQueueNow();
    const saved = JSON.parse(stub.docs.get("telemetry-queue.json") ?? '{"events":[]}');
    return saved.events
      .filter((e) => e.event === "usage_counts" && e.properties.pip_drags)
      .map((e) => ({ total: e.properties.pip_drags, held: e.properties.pip_drags_held_at_edge, slipped: e.properties.pip_drags_slipped }));
  };

  backToTab.notePictureInPictureDragged({ held: false, slipped: false });
  backToTab.notePictureInPictureDragged({ held: true, slipped: false });
  backToTab.notePictureInPictureDragged({ held: false, slipped: true });
  usage.sessionEnding();
  assert.deepEqual(await sentDrags(), [{ total: 3, held: 1, slipped: 1 }]);

  usage.sessionEnding();
  assert.equal((await sentDrags()).length, 1);
});
