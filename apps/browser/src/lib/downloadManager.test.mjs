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

test("the summary adds up running speed, and its time left covers the running downloads only when their sizes are known", () => {
  const s = summarize([dl({ received: 50, total: 100, speed: 10 }), dl({ id: "2", received: 0, total: 100, speed: 15 }), dl({ id: "3", paused: true, received: 10, total: 20, speed: 99 })]);
  assert.equal(s.active, 3);
  assert.equal(s.paused, 1);
  assert.equal(s.speed, 25);
  assert.equal(s.secondsLeft, (200 - 50) / 25, "the paused download's bytes aren't in the estimate");
  assert.equal(summarize([dl({ speed: 5 })]).secondsLeft, null);
  assert.equal(summarize([dl({ paused: true, received: 1, total: 10 })]).secondsLeft, null, "nothing running, no time left");
  assert.equal(summarize([dl({ received: 1, total: 10, speed: 3 }), dl({ id: "2", paused: true, speed: 0 })]).secondsLeft, 3, "a paused download of unknown size doesn't hide the estimate");
});

const { retryWith } = await import("./downloadManager.ts");

function steps(after, { throws = false, window = true } = {}) {
  const log = [];
  return {
    log,
    steps: {
      resume: async (id) => {
        log.push(["resume", id]);
        if (throws) throw new Error("engine said no");
      },
      downloadAgain: (url) => (log.push(["again", url]), window),
      current: (id) => (log.push(["current", id]), after),
      wait: async () => {},
    },
  };
}

test("a cancelled download can't resume, so Retry downloads its own URL again without asking the engine", async () => {
  const { log, steps: s } = steps(undefined);
  assert.equal(await retryWith(dl({ id: "c", state: "cancelled", url: "https://x.example/f" }), s), "again");
  assert.deepEqual(log, [["again", "https://x.example/f"]]);
});

test("a failed download that resumes is left alone; one Chromium won't resume is downloaded again from its own URL", async () => {
  const resumed = steps({ state: "downloading", paused: false });
  assert.equal(await retryWith(dl({ id: "r", state: "failed", url: "https://x.example/r" }), resumed.steps), "resumed");
  assert.deepEqual(resumed.log, [["resume", "r"], ["current", "r"]]);
  const refused = steps({ state: "failed", paused: false }, { throws: true });
  assert.equal(await retryWith(dl({ id: "n", state: "failed", url: "https://x.example/n" }), refused.steps), "again");
  assert.deepEqual(refused.log, [["resume", "n"], ["current", "n"], ["again", "https://x.example/n"]]);
});

test("a download that comes back paused after Retry isn't counted as resumed", async () => {
  const stuck = steps({ state: "downloading", paused: true });
  assert.equal(await retryWith(dl({ id: "p", state: "failed", url: "https://x.example/p" }), stuck.steps), "again");
  assert.deepEqual(stuck.log, [["resume", "p"], ["current", "p"], ["again", "https://x.example/p"]]);
});

test("a download removed while Retry waited isn't downloaded again", async () => {
  const gone = steps(undefined);
  assert.equal(await retryWith(dl({ id: "g", state: "failed" }), gone.steps), "gone");
  assert.deepEqual(gone.log, [["resume", "g"], ["current", "g"]]);
});

test("when its window has closed, Retry reports it instead of downloading somewhere else", async () => {
  const closed = steps(undefined, { window: false });
  assert.equal(await retryWith(dl({ id: "w", state: "cancelled", url: "https://x.example/w" }), closed.steps), "noWindow");
});

test("files of no known kind have their own Other filter", async () => {
  const { DOWNLOAD_FILTERS } = await import("./downloadManager.ts");
  const counts = filterCounts([dl({ filename: "data.xyz" })]);
  assert.ok(DOWNLOAD_FILTERS.some((f) => f.id === "other"));
  assert.equal(counts.other, 1);
});
