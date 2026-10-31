import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const script = readFileSync(new URL("../../../../packages/ardiacore/ios/page_script.js", import.meta.url), "utf8");
const start = script.indexOf("  if (isTop) {\n    const pageHasFocus");
const end = script.indexOf('  send("hello", { top: isTop');
assert.ok(start > 0 && end > start, "page_script.js has the page focus block");
const block = script.slice(start, end);

function frame({ isTop = true, focused = false } = {}) {
  const sent = [];
  const listeners = [];
  class Document {
    hasFocus() {
      return focused;
    }
  }
  const document = new Document();
  const addEventListener = (type, fn, options) => listeners.push({ type, fn, options });
  const guard = (fn) =>
    function () {
      try {
        return Reflect.apply(fn, this, arguments);
      } catch (e) {}
    };
  const send = (kind, data) => sent.push({ kind, data });
  runInNewContext(block, { isTop, document, Document, addEventListener, apply: Reflect.apply, guard, send });
  const press = (isTrusted = true) => {
    for (const l of listeners) if (l.type === "mousedown") l.fn({ isTrusted });
  };
  return { sent, listeners, document, press };
}

test("a click in a top page without page focus asks the browser for it", () => {
  const f = frame();
  f.press();
  assert.deepEqual(f.sent.map((m) => m.kind), ["pageFocusLost"]);
  assert.deepEqual(
    f.listeners.map((l) => [l.type, l.options.capture, l.options.passive]),
    [["mousedown", true, true]],
  );
});

test("a click in a focused page sends nothing", () => {
  const f = frame({ focused: true });
  f.press();
  assert.deepEqual(f.sent, []);
});

test("a synthetic click sends nothing", () => {
  const f = frame();
  f.press(false);
  assert.deepEqual(f.sent, []);
});

test("a page that replaces document.hasFocus can't hide the lost focus", () => {
  const f = frame();
  f.document.hasFocus = () => true;
  f.press();
  assert.equal(f.sent.length, 1);
});

test("subframes don't listen, since a first click into one comes before it takes focus", () => {
  const f = frame({ isTop: false });
  assert.equal(f.listeners.length, 0);
});
