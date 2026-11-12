import assert from "node:assert/strict";
import { after, test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");
const usage = await import("./usage.ts");
const { setPictureInPictureState } = await import("../media/media.ts");
const { diagnostics } = await import("../commands/appCommands.ts");
after(() => client.setSharing(false, "settings"));

async function sentUsageCounts() {
  await client.saveQueueNow();
  const saved = JSON.parse(stub.docs.get("telemetry-queue.json") ?? '{"events":[]}');
  return saved.events
    .filter((e) => e.event === "usage_counts")
    .map((e) =>
      Object.fromEntries(Object.entries(e.properties).filter(([key]) => key.startsWith("pip_closed"))),
    );
}

test("a floating video closing is counted by who closed it and whether it was automatic, sent on its own, then starts again from zero", async () => {
  client.loadChoice();
  client.setSharing(true, "onboarding");

  setPictureInPictureState("a", { kind: "video", active: true });
  setPictureInPictureState("a", { kind: "video", active: false, closedBy: "chrome", auto: true });
  setPictureInPictureState("b", { kind: "video", active: true });
  setPictureInPictureState("b", { kind: "video", active: false, closedBy: "chrome", auto: true });
  setPictureInPictureState("c", { kind: "video", active: false, closedBy: "app", auto: true });
  setPictureInPictureState("d", { kind: "video", active: false, closedBy: "app", auto: false });
  setPictureInPictureState("e", { kind: "video", active: false });
  setPictureInPictureState("f", { kind: "video", active: true, closedBy: "app", auto: true });
  usage.sessionEnding();
  assert.deepEqual(await sentUsageCounts(), [
    { pip_closed_auto_by_app: 1, pip_closed_auto_by_chrome: 2, pip_closed_manual_by_app: 1, pip_closed_manual_by_chrome: 0 },
  ]);

  usage.sessionEnding();
  assert.equal((await sentUsageCounts()).length, 1);
});

test("Copy Diagnostics lists the engine's recent Picture in Picture closes, one per line, and leaves the line out when the engine sends no record", async () => {
  const info = { chromiumVersion: "150.0.0.0" };
  globalThis.acTestEngineInfo = () => info;
  try {
    assert.doesNotMatch(await diagnostics(), /Picture in Picture closes/);

    globalThis.acTestEngineInfo = () => ({
      ...info,
      pictureInPictureCloses:
        "#1 by=chrome kind=video opener=1 enteredAuto=1 chromeAuto=0 hostShown=0 activations=[widget active window=7 ageMs=12] | #2 by=app kind=video opener=1 enteredAuto=0 chromeAuto=0 hostShown=1 activations=none",
    });
    const lines = (await diagnostics()).split("\n");
    const at = lines.findIndex((line) => line.startsWith("Picture in Picture closes:"));
    assert.ok(at > 0);
    assert.match(lines[at], /#1 by=chrome kind=video .* activations=\[widget active window=7 ageMs=12\]$/);
    assert.match(lines[at + 1], /^ {2}#2 by=app kind=video /);
  } finally {
    delete globalThis.acTestEngineInfo;
  }
});
