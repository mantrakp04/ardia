import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const script = readFileSync(new URL("../../../../packages/ardiacore/ios/page_script.js", import.meta.url), "utf8");
const source = script.match(/const playableMedia = (\(all\) => .*);\n/)?.[1];
assert.ok(source, "page_script.js defines playableMedia");
const playableMedia = new Function(`return ${source}`)();

const element = ({ currentSrc = "", src = "", srcObject = null, source = false } = {}) => ({
  currentSrc,
  src,
  srcObject,
  querySelector: (selector) => (selector === "source[src]" && source ? {} : null),
});

test("a media command on a reloaded page reaches its paused <video> even with no MediaSession", () => {
  const empty = element();
  const video = element({ currentSrc: "https://site/clip.mp4" });
  assert.equal(playableMedia([empty, video]), video);
  const sourced = element({ source: true });
  assert.equal(playableMedia([empty, sourced]), sourced, "a <source> child counts before resource selection");
  const stream = element({ srcObject: {} });
  assert.equal(playableMedia([stream]), stream);
  assert.equal(playableMedia([empty]), null, "nothing to play: nothing is played");
});
