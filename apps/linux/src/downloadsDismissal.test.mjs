import assert from "node:assert/strict";
import test from "node:test";
import { startDownloadsDismissal } from "./downloadsDismissal.ts";

function harness({ typing = false } = {}) {
  const target = new EventTarget();
  const bubble = { name: "bubble" };
  const pageWatchers = new Set();
  let clock = 0;
  const closes = [];
  const stop = startDownloadsDismissal({
    target,
    inside: (node) => node === bubble,
    close: () => closes.push(clock),
    watchPageFocus: (listener) => {
      pageWatchers.add(listener);
      return () => pageWatchers.delete(listener);
    },
    activeElement: () => ({ matches: () => typing }),
    now: () => clock,
  });
  const fire = (type, on, extra = {}) => {
    const event = new Event(type, { cancelable: true, bubbles: true });
    Object.defineProperty(event, "target", { value: on });
    Object.assign(event, extra);
    let reached = false;
    const later = () => void (reached = true);
    target.addEventListener(type, later);
    target.dispatchEvent(event);
    target.removeEventListener(type, later);
    return { reached, prevented: event.defaultPrevented };
  };
  return { target, bubble, pageWatchers, closes, stop, fire, tick: (ms) => void (clock += ms) };
}

test("a press outside the bubble closes it and swallows that press, so the button under it doesn't reopen it", () => {
  const h = harness();
  const outside = { name: "sidebar button" };
  assert.equal(h.fire("pointerdown", outside).reached, false);
  assert.equal(h.closes.length, 1);
  assert.equal(h.fire("mousedown", outside).reached, false);
  assert.equal(h.fire("pointerup", outside).reached, false);
  assert.equal(h.fire("click", outside).reached, false);
  assert.equal(h.fire("click", outside).reached, true, "only the closing press is swallowed");
  h.stop();
});

test("presses inside the bubble reach it and keep it open", () => {
  const h = harness();
  for (const type of ["pointerdown", "mousedown", "pointerup", "click"]) assert.equal(h.fire(type, h.bubble).reached, true);
  assert.equal(h.closes.length, 0);
  h.stop();
});

test("a swallowed press that never clicks stops being swallowed after a moment", () => {
  const h = harness();
  h.fire("pointerdown", { name: "outside" });
  h.tick(1000);
  assert.equal(h.fire("click", { name: "elsewhere" }).reached, true);
  h.stop();
});

test("the page taking focus closes it, and stopping releases the page-focus watcher", () => {
  const h = harness();
  assert.equal(h.pageWatchers.size, 1);
  for (const listener of h.pageWatchers) listener();
  assert.equal(h.closes.length, 1);
  h.stop();
  assert.equal(h.pageWatchers.size, 0);
  assert.equal(h.fire("pointerdown", { name: "outside" }).reached, true, "a stopped dismissal leaves presses alone");
});

test("Escape closes it, but not while typing in a field or with a modifier", () => {
  const h = harness();
  assert.equal(h.fire("keydown", h.bubble, { key: "Escape" }).prevented, true);
  assert.equal(h.closes.length, 1);
  h.fire("keydown", h.bubble, { key: "Escape", ctrlKey: true });
  h.fire("keydown", h.bubble, { key: "a" });
  assert.equal(h.closes.length, 1);
  h.stop();
  const typing = harness({ typing: true });
  typing.fire("keydown", typing.bubble, { key: "Escape" });
  assert.equal(typing.closes.length, 0);
  typing.stop();
});
