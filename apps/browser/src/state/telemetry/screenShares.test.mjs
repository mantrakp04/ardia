import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
stub.docs.set("telemetry.json", JSON.stringify({ version: 99, sharing: true, installId: "screen-shares", decidedAt: 1, askDoneAt: 1, crashCursor: 0, lastVersion: null, sessionOpen: false }));
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");
client.loadChoice();
const { endRunningScreenShares, noteDisplayAnswer, noteScreenAccess, resumeScreenShares, screenSharePages } = await import("./screenShares.ts");
after(() => client.setSharing(false, "settings"));

const idle = { mediaAccess: null };
const live = { mediaAccess: { camera: false, microphone: false, screen: true } };

const shareEvents = async () => {
  await client.saveQueueNow();
  const queue = JSON.parse(stub.docs.get("telemetry-queue.json") ?? '{"events":[]}');
  return queue.events.filter((e) => e.event.startsWith("screen_share_")).map((e) => [e.event, e.properties.via, e.properties.seconds]);
};

test("a share nobody answered in Ardia's sheet came through the system picker", async () => {
  noteScreenAccess("tab-a", true, 1_000_000);
  noteScreenAccess("tab-a", false, 1_042_400);
  assert.deepEqual(await shareEvents(), [
    ["screen_share_started", "system_picker", undefined],
    ["screen_share_ended", "system_picker", 42],
  ]);
});

test("an answer from the sheet or the tab list names how the share was picked", async () => {
  noteDisplayAnswer("tab-b", "sheet", 2_000_000);
  noteScreenAccess("tab-b", true, 2_000_800);
  noteDisplayAnswer("tab-c", "tab", 2_001_000);
  noteScreenAccess("tab-c", true, 2_001_500);
  assert.deepEqual((await shareEvents()).slice(2), [
    ["screen_share_started", "sheet", undefined],
    ["screen_share_started", "tab", undefined],
  ]);
  noteScreenAccess("tab-b", false, 2_005_000);
  noteScreenAccess("tab-c", false, 2_006_000);
  assert.deepEqual((await shareEvents()).slice(4), [
    ["screen_share_ended", "sheet", 4],
    ["screen_share_ended", "tab", 5],
  ]);
});

test("an answer is used once, and a stale one is not matched to a later share", async () => {
  const before = (await shareEvents()).length;
  noteDisplayAnswer("tab-d", "sheet", 3_000_000);
  noteScreenAccess("tab-d", true, 3_000_500);
  noteScreenAccess("tab-d", false, 3_001_000);
  noteScreenAccess("tab-d", true, 3_002_000);
  noteScreenAccess("tab-d", false, 3_003_000);
  noteDisplayAnswer("tab-e", "sheet", 3_010_000);
  noteScreenAccess("tab-e", true, 3_030_000);
  const started = (await shareEvents()).slice(before).filter(([event]) => event === "screen_share_started");
  assert.deepEqual(
    started.map(([, via]) => via),
    ["sheet", "system_picker", "system_picker"],
  );
  noteScreenAccess("tab-e", false, 3_031_000);
});

test("the page store drives it: a screen flag turning on starts a share, and turning off or closing the tab ends it", async () => {
  const before = (await shareEvents()).length;
  screenSharePages({ f: live }, { f: idle }, 4_000_000);
  screenSharePages({ f: live }, { f: live }, 4_001_000);
  screenSharePages({}, { f: live }, 4_007_000);
  assert.deepEqual((await shareEvents()).slice(before), [
    ["screen_share_started", "system_picker", undefined],
    ["screen_share_ended", "system_picker", 7],
  ]);
});

test("camera and microphone access alone is not a screen share", async () => {
  const before = (await shareEvents()).length;
  screenSharePages({ g: { mediaAccess: { camera: true, microphone: true, screen: false } } }, { g: { mediaAccess: null } }, 5_000_000);
  assert.equal((await shareEvents()).length, before);
});

test("quitting ends the shares still running, once each, with the seconds they lasted", async () => {
  const before = (await shareEvents()).length;
  noteDisplayAnswer("tab-i", "tab", 7_000_000);
  noteScreenAccess("tab-i", true, 7_000_200);
  noteScreenAccess("tab-j", true, 7_000_300);
  noteScreenAccess("tab-j", false, 7_002_000);
  endRunningScreenShares(7_030_200);
  endRunningScreenShares(7_060_000);
  noteScreenAccess("tab-i", false, 7_061_000);
  assert.deepEqual((await shareEvents()).slice(before), [
    ["screen_share_started", "tab", undefined],
    ["screen_share_started", "system_picker", undefined],
    ["screen_share_ended", "system_picker", 2],
    ["screen_share_ended", "tab", 30],
  ]);
  resumeScreenShares({}, 7_070_000);
});

test("a cancelled quit resumes the shares that are still on, in the way they were picked, and not the ones that stopped meanwhile", async () => {
  const before = (await shareEvents()).length;
  noteDisplayAnswer("tab-k", "sheet", 8_000_000);
  noteScreenAccess("tab-k", true, 8_000_100);
  noteScreenAccess("tab-l", true, 8_000_200);
  endRunningScreenShares(8_010_100);
  noteScreenAccess("tab-l", false, 8_015_000);
  resumeScreenShares({ "tab-k": live, "tab-l": idle }, 8_020_000);
  noteScreenAccess("tab-k", false, 8_025_000);
  assert.deepEqual((await shareEvents()).slice(before), [
    ["screen_share_started", "sheet", undefined],
    ["screen_share_started", "system_picker", undefined],
    ["screen_share_ended", "sheet", 10],
    ["screen_share_ended", "system_picker", 10],
    ["screen_share_started", "sheet", undefined],
    ["screen_share_ended", "sheet", 5],
  ]);
});

test("a share that begins while the quit is waiting is not recorded, since the app may exit before its end, and is picked up when the quit is cancelled", async () => {
  const before = (await shareEvents()).length;
  endRunningScreenShares(9_000_000);
  noteScreenAccess("tab-m", true, 9_001_000);
  assert.deepEqual((await shareEvents()).slice(before), []);
  resumeScreenShares({ "tab-m": live }, 9_002_000);
  noteScreenAccess("tab-m", false, 9_005_000);
  assert.deepEqual((await shareEvents()).slice(before), [
    ["screen_share_started", "system_picker", undefined],
    ["screen_share_ended", "system_picker", 3],
  ]);
});

test("a share that is already running is not started a second time when the quit is cancelled", async () => {
  const before = (await shareEvents()).length;
  noteScreenAccess("tab-n", true, 9_100_000);
  resumeScreenShares({ "tab-n": live }, 9_101_000);
  noteScreenAccess("tab-n", false, 9_104_000);
  assert.deepEqual((await shareEvents()).slice(before), [
    ["screen_share_started", "system_picker", undefined],
    ["screen_share_ended", "system_picker", 4],
  ]);
});

test("nothing is kept while sharing is off, and a share that began then is not reported when sharing comes back", async () => {
  client.setSharing(false, "settings");
  noteDisplayAnswer("tab-h", "sheet", 6_000_000);
  noteScreenAccess("tab-h", true, 6_000_100);
  assert.deepEqual(await shareEvents(), []);
  client.setSharing(true, "settings");
  noteScreenAccess("tab-h", false, 6_001_000);
  assert.deepEqual(await shareEvents(), []);
});

test("usage.ts ends the shares when the session ends and resumes them when the quit is cancelled", () => {
  const usage = readFileSync(new URL("./usage.ts", import.meta.url), "utf8");
  assert.match(usage, /e\.type === "willQuit"\) \{[^}]*sessionEnding\(\)/);
  assert.match(usage, /function sessionEnding\(\) \{[^}]*endRunningScreenShares\(\)/);
  assert.match(usage, /e\.type === "quitCancelled"\) \{[^}]*resumeScreenShares\(usePages\.getState\(\)\.pages\)/);
});
