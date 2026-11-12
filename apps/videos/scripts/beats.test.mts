import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as launch from "../src/lib/ac-launch/plan.ts";
import * as sharedFolders from "../src/lib/sf-film/plan.ts";

const framesPerBeat = (score: { fps: number; bpm: number }) => Math.round(((score.fps * 60) / score.bpm) * 1e6) / 1e6;
const cuts = (film: string) => JSON.parse(readFileSync(new URL(`../src/lib/${film}/cuts.json`, import.meta.url), "utf8"));

test("the launch film's beat grid matches the score's cuts.json", () => {
  const score = cuts("ac-launch");
  assert.equal(launch.BEAT, framesPerBeat(score));
  for (const [name, cut] of Object.entries(launch.CUTS)) assert.equal(cut.beats, score.cuts[name].beats, name);
});

test("the Shared Folders film's beat grid matches the score's cuts.json", () => {
  const score = cuts("sf-film");
  assert.equal(sharedFolders.BEAT, score.beatFrames);
  assert.equal(sharedFolders.BEAT, framesPerBeat(score));
  for (const cut of Object.values(sharedFolders.CUTS)) assert.equal(cut.beats, score.beats);
});
