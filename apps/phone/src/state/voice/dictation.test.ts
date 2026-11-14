import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accessResolved,
  begin,
  DICTATION_IDLE,
  failed,
  FIRST_WORDS_GRACE_MS,
  heard,
  LEVEL_BARS,
  leveled,
  pushLevel,
  recorderFailed,
  silenceWait,
  SILENCE_TIMEOUT_MS,
  stopped,
  voiceControl,
  type Dictation,
} from "./dictation.ts";

function listening(): Dictation {
  const asked = begin(DICTATION_IDLE);
  return accessResolved(asked, asked.attempt, "granted");
}

test("starting asks for access once, then listens with an empty transcript", () => {
  const asked = begin(DICTATION_IDLE);
  assert.equal(asked.phase, "requesting");
  assert.equal(begin(asked), asked);
  const on = accessResolved(asked, asked.attempt, "granted");
  assert.equal(on.phase, "listening");
  assert.equal(begin(on), on);
});

test("denied access asks for Settings, and a missing recognizer is unavailable", () => {
  const asked = begin(DICTATION_IDLE);
  assert.equal(accessResolved(asked, asked.attempt, "denied").phase, "denied");
  assert.deepEqual(accessResolved(asked, asked.attempt, "unavailable"), { ...asked, phase: "unavailable", problem: "service" });
});

test("an answer for an earlier attempt is ignored", () => {
  const asked = begin(DICTATION_IDLE);
  const cancelled = stopped(asked);
  assert.equal(cancelled.phase, "idle");
  assert.equal(accessResolved(cancelled, asked.attempt, "granted"), cancelled);
  const on = listening();
  assert.equal(heard(on, on.attempt - 1, "old", false), on);
  assert.equal(leveled(on, on.attempt + 1, 0.5), on);
});

test("partial words update the transcript, and final words finish it", () => {
  const on = listening();
  const partial = heard(on, on.attempt, "weather in", false);
  assert.equal(partial.phase, "listening");
  assert.equal(partial.transcript, "weather in");
  const done = heard(partial, partial.attempt, "weather in Lisbon", true);
  assert.equal(done.phase, "finished");
  assert.equal(done.transcript, "weather in Lisbon");
  assert.equal(done.level, 0);
  assert.equal(heard(done, partial.attempt, "late", false), done);
});

test("stopping with nothing heard says so", () => {
  const off = stopped(listening());
  assert.equal(off.phase, "unavailable");
  assert.equal(off.problem, "heardNothing");
});

test("a recognizer error keeps words already heard, and otherwise names the problem", () => {
  const on = listening();
  const words = heard(on, on.attempt, "maps", false);
  assert.equal(failed(words, words.attempt, "service").phase, "finished");
  assert.deepEqual([failed(on, on.attempt, "language").phase, failed(on, on.attempt, "language").problem], ["unavailable", "language"]);
  assert.equal(failed(on, on.attempt, null).problem, "heardNothing");
  assert.equal(recorderFailed(on, on.attempt).problem, "service");
});

test("the mic level stays between 0 and 1", () => {
  const on = listening();
  assert.equal(leveled(on, on.attempt, 3).level, 1);
  assert.equal(leveled(on, on.attempt, -1).level, 0);
});

test("silence ends listening after 1.6 s, with 4 s more before the first words", () => {
  const on = listening();
  assert.equal(silenceWait(on), SILENCE_TIMEOUT_MS + FIRST_WORDS_GRACE_MS);
  assert.equal(silenceWait(heard(on, on.attempt, "a", false)), SILENCE_TIMEOUT_MS);
});

test("the button is Done while listening, Search with words, Try Again otherwise", () => {
  const on = listening();
  assert.deepEqual(voiceControl(on), { kind: "done" });
  assert.deepEqual(voiceControl(stopped(heard(on, on.attempt, " news ", false))), { kind: "search", text: "news" });
  assert.deepEqual(voiceControl(stopped(on)), { kind: "tryAgain" });
  assert.equal(voiceControl(begin(DICTATION_IDLE)), null);
});

test("the waveform keeps the last 24 levels", () => {
  let levels = Array<number>(LEVEL_BARS).fill(0);
  for (let i = 1; i <= 30; i += 1) levels = pushLevel(levels, i);
  assert.equal(levels.length, LEVEL_BARS);
  assert.equal(levels[0], 7);
  assert.equal(levels[LEVEL_BARS - 1], 30);
});
