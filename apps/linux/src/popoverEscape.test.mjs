import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { closeWindowPopovers, dismissesPopover, startPopoverEscape } from "./popoverEscape.ts";
import { useBrowser } from "../../browser/src/state/browser/store.ts";
import { usePages } from "../../browser/src/state/tabs/pageState.ts";

const escape = (patch = {}) => {
  const event = new Event("keydown", { cancelable: true });
  Object.assign(event, { key: "Escape", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false }, patch);
  return event;
};

function seed() {
  useBrowser.setState((s) => ({ tabs: { ...s.tabs, here: { id: "here", windowId: "main", page: { kind: "idle" }, pin: null }, split: { id: "split", windowId: "main", page: { kind: "idle" }, pin: null }, there: { id: "there", windowId: "other", page: { kind: "idle" }, pin: null } } }));
  usePages.setState({ popover: { here: "zoom", split: null, there: "siteControls" } });
}

function shell({ menu = false, typing = false } = {}) {
  const target = new EventTarget();
  const stop = startPopoverEscape({ target, windowId: "main", menuShown: () => menu, activeElement: () => (typing ? { matches: () => true } : null) });
  return { target, stop };
}

test("Escape in the shell closes the popovers of its own window's tabs and consumes the key", () => {
  seed();
  const { target, stop } = shell();
  const event = escape();
  target.dispatchEvent(event);
  assert.deepEqual(usePages.getState().popover, { here: null, split: null, there: "siteControls" });
  assert.equal(event.defaultPrevented, true);
  const again = escape();
  target.dispatchEvent(again);
  assert.equal(again.defaultPrevented, false, "with nothing open the key is left alone");
  stop();
});

test("Escape leaves popovers open when a menu, a text field, a modifier or an earlier handler has it", () => {
  seed();
  for (const [options, patch] of [[{ menu: true }, {}], [{ typing: true }, {}], [{}, { shiftKey: true }], [{}, { ctrlKey: true }], [{}, { isComposing: true }]]) {
    const { target, stop } = shell(options);
    target.dispatchEvent(escape(patch));
    stop();
    assert.equal(usePages.getState().popover.here, "zoom", JSON.stringify({ options, patch }));
  }
  const { target, stop } = shell();
  const handled = escape();
  handled.preventDefault();
  target.dispatchEvent(handled);
  stop();
  assert.equal(usePages.getState().popover.here, "zoom");
  const later = shell();
  later.stop();
  later.target.dispatchEvent(escape());
  assert.equal(usePages.getState().popover.here, "zoom", "a stopped listener no longer closes popovers");
});

test("only an unmodified, unhandled Escape dismisses", () => {
  assert.equal(dismissesPopover(escape(), false, false), true);
  assert.equal(dismissesPopover(escape({ key: "Enter" }), false, false), false);
  assert.equal(dismissesPopover(escape({ altKey: true }), false, false), false);
  assert.equal(dismissesPopover(escape({ metaKey: true }), false, false), false);
  assert.equal(dismissesPopover(escape(), true, false), false);
  assert.equal(dismissesPopover(escape(), false, true), false);
  seed();
  assert.equal(closeWindowPopovers("elsewhere"), false);
  assert.equal(closeWindowPopovers("other"), true);
  assert.equal(usePages.getState().popover.there, null);
});

test("browser windows start the popover Escape handler after hydrating, utility windows keep their own", () => {
  const main = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
  const browser = main.slice(main.indexOf("  } else {"), main.indexOf("  createRoot("));
  assert.match(browser, /startPopoverEscape\(\{ target: window, windowId, menuShown, activeElement: \(\) => document\.activeElement \}\);/);
  const utility = main.slice(main.indexOf("  if (utility) {"), main.indexOf("  } else {"));
  assert.doesNotMatch(utility, /startPopoverEscape/);
});
