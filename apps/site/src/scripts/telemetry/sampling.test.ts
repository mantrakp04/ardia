import assert from "node:assert/strict";
import { test } from "node:test";
import { REPLAY_SAMPLE_RATE } from "../../data/telemetry.ts";
import { inSample, startWhenSampled } from "./sampling.ts";

const kept = "019a0000-0000-7000-8000-000000000000";
const dropped = "019a0000-0000-7000-8000-ffffffffffff";
const keep = (id: string) => inSample(id, REPLAY_SAMPLE_RATE);

function openTab(firstSession: string) {
  const changes: ((id: string) => void)[] = [];
  let started = 0;
  startWhenSampled(firstSession, keep, (fn) => changes.push(fn), () => started++);
  return {
    started: () => started,
    newSession: (id: string) => changes.forEach((fn) => fn(id)),
  };
}

test("only part of the sessions are recorded, each kept or dropped whole", () => {
  assert.ok(REPLAY_SAMPLE_RATE > 0 && REPLAY_SAMPLE_RATE < 1);
  assert.equal(inSample(kept, REPLAY_SAMPLE_RATE), true);
  assert.equal(inSample(dropped, REPLAY_SAMPLE_RATE), false);
  assert.equal(inSample(dropped, 1), true);
});

test("a tab whose first session is sampled starts recording once", () => {
  const tab = openTab(kept);
  assert.equal(tab.started(), 1);
  tab.newSession(kept);
  assert.equal(tab.started(), 1, "the recorder follows later sessions itself");
});

test("a tab whose first session is skipped records the next session that is sampled", () => {
  const tab = openTab(dropped);
  assert.equal(tab.started(), 0);
  tab.newSession(dropped);
  assert.equal(tab.started(), 0, "a skipped session starts nothing");
  tab.newSession(kept);
  assert.equal(tab.started(), 1, "the sampled session after the idle gap is recorded");
  tab.newSession(kept);
  assert.equal(tab.started(), 1, "it starts once");
});
