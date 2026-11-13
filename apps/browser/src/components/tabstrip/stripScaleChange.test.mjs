import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { Animated } from "../../test-native/reactNative.ts";
import { interfaceMetrics, scaleMetrics } from "../../lib/interfaceMetrics.ts";
import { TOP_STRIP_HEIGHT, ONTO_EDGE, LIFT_SLOP, LIFT_MS, SLIDE } from "./tokens.ts";

const require = createRequire(import.meta.url);
const { transpileModule, ScriptTarget, ModuleKind } = require("typescript");
const source = readFileSync(new URL("./useStripDrag.ts", import.meta.url), "utf8").replace(/^import .*;\n/gm, "");
const compiled = transpileModule(source, { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.CommonJS } }).outputText;

function harness() {
  const slots = [];
  let cursor = 0;
  let preset = "100";
  let effects = [];
  let cancelled = 0;
  let lifted;
  let edge;
  const changed = (a, b) => !a || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
  const useRef = (initial) => slots[cursor++] ??= { current: initial };
  const context = {
    exports: {}, Animated: { ...Animated, add: (a, b) => ({ a, b }) }, TOP_STRIP_HEIGHT, ONTO_EDGE, LIFT_SLOP, LIFT_MS, SLIDE, scaleMetrics,
    useInterfaceMetrics: () => interfaceMetrics(preset), useRef,
    useState: (initial) => { const cell = useRef(initial); return [cell.current, (v) => { cell.current = v; }]; },
    useMemo: (resolve, deps) => { const i = cursor++; if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { deps, value: resolve() }; return slots[i].value; },
    useEffect: (effect, deps) => { const i = cursor++; if (!slots[i] || changed(slots[i].deps, deps)) { effects.push(effect); slots[i] = { deps }; } },
    PanResponder: { create: (handlers) => ({ panHandlers: handlers }) },
    findNodeHandle: () => 1, curve: { enter: (x) => x }, registerSlot: () => () => {},
    raiseView: () => {}, setStripOnto: () => {}, ontoKey: () => null,
    beginTabDrag: () => 1, cancelTabDrag: () => { cancelled++; }, tabDragging: () => false,
    setDragPicture: () => {}, updateTabDrag: (_x, _y, value) => { lifted = value; },
    aimDrop: (_geometry, _from, _x, _targets, value) => { edge = value; return { to: 0 }; },
    dropIndex: () => 0, dragRange: () => [-100, 100], makeRoom: () => {}, settleRoom: () => {},
    endHeldTabPress: () => {}, TAB_CLICK_SLOP: 5,
  };
  runInNewContext(compiled, context);
  const item = { width: 100, gap: 4, from: 0, tabId: "a", ids: () => ["a"], geometry: { lefts: [0] }, targets: [{}] };
  return {
    render(next) {
      preset = next;
      cursor = 0;
      const result = context.exports.useStripDrag(item);
      for (const effect of effects) effect();
      effects = [];
      result.ref.current = { measureInWindow: (done) => done(0, 0, 100, TOP_STRIP_HEIGHT * interfaceMetrics(next).factor) };
      return result;
    },
    get cancelled() { return cancelled; }, get lifted() { return lifted; }, get edge() { return edge; },
  };
}

const event = { nativeEvent: { pageX: 50, pageY: 10 } };
const gesture = (y) => ({ moveX: 50, moveY: y, dx: 5, dy: y - 10 });

test("a responder mounted at 100% uses current strip height and onto edge after switching to 150%", () => {
  const h = harness();
  const before = h.render("100");
  const after = h.render("150");
  assert.equal(after.panHandlers, before.panHandlers);
  after.panHandlers.onPanResponderGrant(event, gesture(10));
  after.panHandlers.onPanResponderMove(event, gesture(65));
  assert.equal(h.lifted, false);
  assert.equal(h.edge, ONTO_EDGE * 1.5);
  after.panHandlers.onPanResponderMove(event, gesture(80));
  assert.equal(h.lifted, true);
});

test("changing the preset cancels an active top-tab drag and ignores its later events", () => {
  const h = harness();
  const drag = h.render("100");
  drag.panHandlers.onPanResponderGrant(event, gesture(10));
  h.render("150");
  assert.equal(h.cancelled, 1);
  drag.panHandlers.onPanResponderMove(event, gesture(100));
  drag.panHandlers.onPanResponderRelease(event, gesture(100));
  assert.equal(h.lifted, undefined);
});
