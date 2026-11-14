import assert from "node:assert/strict";
import { after, test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");
const usage = await import("./usage.ts");
const fairPlay = await import("./fairPlayCounts.ts");
after(() => client.setSharing(false, "settings"));

async function sentUsageCounts() {
  await client.saveQueueNow();
  const saved = JSON.parse(stub.docs.get("telemetry-queue.json") ?? '{"events":[]}');
  return saved.events
    .filter((e) => e.event === "usage_counts")
    .map((e) => ({
      played: e.properties.fairplay_played,
      license: e.properties.fairplay_failed_license,
      playback: e.properties.fairplay_failed_playback,
      player: e.properties.fairplay_failed_player,
    }));
}

test("FairPlay bridge plays and failures are counted per step, unknown reports are ignored, sent on their own, then start again from zero", async () => {
  client.loadChoice();
  client.setSharing(true, "onboarding");

  fairPlay.noteFairPlay({ event: "played" });
  fairPlay.noteFairPlay({ event: "played" });
  fairPlay.noteFairPlay({ event: "failed", step: "license" });
  fairPlay.noteFairPlay({ event: "failed", step: "player" });
  fairPlay.noteFairPlay({ event: "failed", step: "player" });
  fairPlay.noteFairPlay({ event: "failed", step: "somewhere" });
  fairPlay.noteFairPlay({ event: "failed" });
  fairPlay.noteFairPlay({ event: "paused" });
  usage.sessionEnding();
  assert.deepEqual(await sentUsageCounts(), [{ played: 2, license: 1, playback: 0, player: 2 }]);

  usage.sessionEnding();
  assert.equal((await sentUsageCounts()).length, 1);
});
