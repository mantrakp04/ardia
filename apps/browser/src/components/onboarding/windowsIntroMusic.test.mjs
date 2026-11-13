import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { INTRO_CUES } from "./introCues.ts";

const windows = new URL("../../../windows/Ardia/", import.meta.url);
const repo = new URL("../../../../../", import.meta.url);

test("the Windows intro music was rendered with the intro's cues and the Mac's current synthesis (scripts/windows/render-intro-music.sh)", () => {
  const rendered = JSON.parse(readFileSync(new URL("IntroMusic.json", windows), "utf8"));
  assert.deepEqual(rendered.cues, INTRO_CUES);
  const source = createHash("sha256")
    .update(readFileSync(new URL("packages/shell/ios/IntroMusic.swift", repo)))
    .update(readFileSync(new URL("scripts/windows/render-intro-music.sh", repo)))
    .digest("hex");
  assert.equal(rendered.source, source, "IntroMusic.swift or the render script changed: run scripts/windows/render-intro-music.sh");
  const wav = readFileSync(new URL("IntroMusic.wav", windows));
  assert.equal(wav.subarray(0, 4).toString(), "RIFF");
  assert.equal(wav.subarray(8, 12).toString(), "WAVE");
});

test("the Windows resource file embeds the intro music", () => {
  assert.match(readFileSync(new URL("Ardia.rc", windows), "utf8"), /^IDR_INTRO_MUSIC RCDATA "IntroMusic\.wav"\r?$/m);
  assert.match(readFileSync(new URL("resource.h", windows), "utf8"), /^#define IDR_INTRO_MUSIC \d+\r?$/m);
});
