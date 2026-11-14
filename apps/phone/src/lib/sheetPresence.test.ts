import assert from "node:assert/strict";
import test from "node:test";
import { initialPresence, presenceCovers, presenceSettled, presenceShown, presenceTarget, type Presence } from "./sheetPresence.ts";

type Sheet = "settings" | "archive" | "spaces";

function driver(start: Sheet | null = null) {
  let presence: Presence<Sheet> = initialPresence(start);
  const closes: number[] = [];
  const to = (target: Sheet | null) => {
    const step = presenceTarget(presence, target);
    presence = step.presence;
    if (step.motion === "out") closes.push(presence.generation);
    return step;
  };
  const settle = (generation: number, finished = true) => {
    presence = presenceSettled(presence, generation, finished);
  };
  const check = () => {
    if (presence.target !== null) assert.equal(presenceShown(presence), presence.target, "an open sheet is always the one shown");
    assert.equal(presenceCovers(presence), presence.target !== null, "the cover follows the target alone");
  };
  return { to, settle, check, closes, now: () => presence };
}

test("opening during a close keeps the new sheet even when the old close's completion arrives late", () => {
  const d = driver();
  d.to("settings");
  d.to(null);
  const closing = d.closes.at(-1)!;
  const reopen = d.to("settings");
  assert.equal(reopen.fromHidden, false, "the sheet springs back from where it is, not from the bottom");
  d.settle(closing, true);
  d.check();
  assert.equal(presenceShown(d.now()), "settings");
  assert.equal(presenceCovers(d.now()), true);
});

test("the owner's repro: Settings, Archive, Done, Settings, Done, Settings, with every close finishing late", () => {
  const d = driver();
  d.to("settings");
  d.to("archive");
  d.check();
  d.to(null);
  const first = d.closes.at(-1)!;
  d.to("settings");
  d.settle(first);
  d.check();
  d.to(null);
  const second = d.closes.at(-1)!;
  d.to("settings");
  d.settle(second);
  d.check();
  assert.equal(presenceShown(d.now()), "settings");
});

test("closing during an open hides the sheet once that close finishes, and an interrupted close changes nothing", () => {
  const d = driver();
  d.to("archive");
  d.to(null);
  const closing = d.closes.at(-1)!;
  assert.equal(presenceShown(d.now()), "archive", "it stays drawn while it slides away");
  assert.equal(presenceCovers(d.now()), false, "the deck is reachable as soon as the close starts");
  d.settle(closing, false);
  assert.equal(presenceShown(d.now()), "archive");
  d.settle(closing, true);
  assert.equal(presenceShown(d.now()), null);
});

test("going from one sheet straight to another shows the second at once, without sliding in from the bottom", () => {
  const d = driver();
  d.to("settings");
  const step = d.to("spaces");
  assert.equal(step.motion, "in");
  assert.equal(step.fromHidden, false);
  d.check();
  assert.equal(presenceShown(d.now()), "spaces");
});

test("rapid toggling with completions arriving late and out of order never leaves a sheet open but not shown, or shown after the last close", () => {
  const d = driver();
  const pending: number[] = [];
  const order: (Sheet | null)[] = ["settings", null, "settings", null, "archive", "spaces", null, "settings", null, null, "settings", null];
  order.forEach((target, index) => {
    d.to(target);
    if (target === null && d.closes.length) pending.push(d.closes.at(-1)!);
    if (index % 3 === 2) for (const generation of pending.splice(0).reverse()) d.settle(generation);
    d.check();
  });
  for (const generation of pending.splice(0)) d.settle(generation);
  d.check();
  assert.equal(presenceShown(d.now()), null);
  assert.equal(presenceCovers(d.now()), false);
  d.to("settings");
  d.check();
  assert.equal(presenceShown(d.now()), "settings", "Settings still opens afterwards");
});

test("a close that has nothing to hide does nothing, and the fallback and the spring settling twice is harmless", () => {
  const d = driver();
  assert.equal(d.to(null).motion, "none");
  d.to("spaces");
  d.to(null);
  const closing = d.closes.at(-1)!;
  d.settle(closing);
  d.settle(closing);
  assert.equal(presenceShown(d.now()), null);
});
