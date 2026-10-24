import assert from "node:assert/strict";
import { test } from "node:test";
const { kindOf, matchesFilter, filterCounts, summarize } = await import("./downloadManager.ts");

const dl = (over) => ({ id: "1", url: "https://x.example/f", filename: "f.bin", path: "", state: "downloading", paused: false, received: 0, total: 0, speed: 0, mimeType: "", ...over });

test("downloads sort into kinds by extension, then by mime type", () => {
  assert.equal(kindOf(dl({ filename: "Report.PDF" })), "document");
  assert.equal(kindOf(dl({ filename: "Ardia.dmg" })), "app");
  assert.equal(kindOf(dl({ filename: "clip.mov" })), "video");
  assert.equal(kindOf(dl({ filename: "noext", mimeType: "audio/mpeg" })), "audio");
  assert.equal(kindOf(dl({ filename: "weird.xyz" })), "other");
});

test("filters split active, finished and failed, and count each", () => {
  const list = [dl({ id: "a" }), dl({ id: "b", state: "finished", filename: "a.zip" }), dl({ id: "c", state: "failed" }), dl({ id: "d", state: "cancelled" })];
  assert.deepEqual(list.filter((d) => matchesFilter(d, "failed")).map((d) => d.id), ["c", "d"]);
  const counts = filterCounts(list);
  assert.equal(counts.all, 4);
  assert.equal(counts.active, 1);
  assert.equal(counts.archive, 1);
});

test("the summary adds up running speed and gives one time left only when every active size is known", () => {
  const s = summarize([dl({ received: 50, total: 100, speed: 10 }), dl({ id: "2", received: 0, total: 100, speed: 15 }), dl({ id: "3", paused: true, received: 10, total: 20, speed: 99 })]);
  assert.equal(s.active, 3);
  assert.equal(s.paused, 1);
  assert.equal(s.speed, 25);
  assert.equal(s.secondsLeft, (220 - 60) / 25);
  assert.equal(summarize([dl({ speed: 5 })]).secondsLeft, null);
});

const { retryWith } = await import("./downloadManager.ts");

function steps(after, { throws = false } = {}) {
  const log = [];
  return {
    log,
    steps: {
      resume: async (id) => {
        log.push(["resume", id]);
        if (throws) throw new Error("engine said no");
      },
      downloadAgain: (url) => log.push(["again", url]),
      current: () => after,
      wait: async () => {},
    },
  };
}

test("a cancelled download can't resume, so Retry downloads it again without asking the engine", async () => {
  const { log, steps: s } = steps(undefined);
  assert.equal(await retryWith(dl({ id: "c", state: "cancelled", url: "https://x.example/f" }), s), "again");
  assert.deepEqual(log, [["again", "https://x.example/f"]]);
});

test("a failed download that resumes is left alone; one Chromium won't resume is downloaded again", async () => {
  const resumed = steps({ state: "downloading", paused: false });
  assert.equal(await retryWith(dl({ state: "failed" }), resumed.steps), "resumed");
  assert.deepEqual(resumed.log.map((l) => l[0]), ["resume"]);
  const refused = steps({ state: "failed", paused: false }, { throws: true });
  assert.equal(await retryWith(dl({ state: "failed" }), refused.steps), "again");
  assert.deepEqual(refused.log.map((l) => l[0]), ["resume", "again"]);
});

test("a download removed from the list while Retry waited isn't downloaded again", async () => {
  const gone = steps(undefined);
  assert.equal(await retryWith(dl({ state: "failed" }), gone.steps), "gone");
  assert.deepEqual(gone.log.map((l) => l[0]), ["resume"]);
});
