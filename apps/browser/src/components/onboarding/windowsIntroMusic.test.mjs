import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { INTRO_CUES } from "./introCues.ts";

const windows = new URL("../../../windows/Ardia/", import.meta.url);

test("the Windows intro music was rendered with the intro's cues (scripts/windows/render-intro-music.sh)", () => {
  assert.deepEqual(JSON.parse(readFileSync(new URL("IntroMusic.json", windows), "utf8")), INTRO_CUES);
  const wav = readFileSync(new URL("IntroMusic.wav", windows));
  assert.equal(wav.subarray(0, 4).toString(), "RIFF");
  assert.equal(wav.subarray(8, 12).toString(), "WAVE");
});

test("the Windows resource file embeds the intro music", () => {
  assert.match(readFileSync(new URL("Ardia.rc", windows), "utf8"), /^IDR_INTRO_MUSIC RCDATA "IntroMusic\.wav"\r?$/m);
  assert.match(readFileSync(new URL("resource.h", windows), "utf8"), /^#define IDR_INTRO_MUSIC \d+\r?$/m);
});
