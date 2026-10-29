import assert from "node:assert/strict";
import { test } from "node:test";
import { playByClickWith, videoPlaying } from "../lib/desktopMedia.mjs";

const run = async (states) => {
  let clicks = 0;
  const read = async () => states.shift() ?? states.at(-1);
  const result = await playByClickWith({ read, click: async () => { clicks++; }, wait: async () => true });
  return { clicks, result };
};

test("a playing video at its loop point is not clicked, which would pause it", async () => {
  assert.equal((await run([{ paused: false, ended: false, currentTime: 0.05 }])).clicks, 0);
  assert.equal((await run([{ paused: false, ended: false, currentTime: 3 }])).clicks, 0);
});

test("a paused, ended or missing video is clicked once", async () => {
  assert.equal((await run([{ paused: true, ended: false, currentTime: 2 }])).clicks, 1);
  assert.equal((await run([{ paused: false, ended: true, currentTime: 8 }])).clicks, 1);
  assert.equal((await run([null])).clicks, 1);
});

test("playing means unpaused and past its first fifth of a second", () => {
  assert.equal(videoPlaying({ paused: false, ended: false, currentTime: 0.3 }), true);
  assert.equal(videoPlaying({ paused: false, ended: false, currentTime: 0.1 }), false);
  assert.equal(videoPlaying({ paused: true, ended: false, currentTime: 3 }), false);
  assert.equal(videoPlaying(null), false);
});
