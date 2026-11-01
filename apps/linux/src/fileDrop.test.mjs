import assert from "node:assert/strict";
import test from "node:test";
import { acceptsDrag, createDropController, domDropItems, dragCount, parseUriList, validFileUrl } from "./fileDrop.ts";
import { createFileDragGesture, FILE_DRAG_THRESHOLD } from "./fileDrag.ts";
import { watchDropArea } from "./shims/web/dropArea.ts";
import { watchFileDragArea } from "./shims/web/fileDragArea.ts";

class FakeTarget {
  listeners = new Map();
  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l !== listener));
  }
  dispatch(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return event;
  }
  get listening() {
    return [...this.listeners.values()].reduce((n, list) => n + list.length, 0);
  }
}

globalThis.Node ??= class Node {};
globalThis.Element ??= class Element extends globalThis.Node {};

class FakeElement extends globalThis.Element {
  listeners = new Map();
  constructor({ parent = null, editable = false } = {}) {
    super();
    this.parent = parent;
    this.editable = editable;
  }
  closest() {
    for (let node = this; node; node = node.parent) if (node.editable) return node;
    return null;
  }
  contains(node) {
    for (let at = node; at; at = at.parent) if (at === this) return true;
    return false;
  }
  getBoundingClientRect() {
    return { left: 10, top: 20 };
  }
}

for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(FakeTarget.prototype))) {
  if (key !== "constructor") Object.defineProperty(FakeElement.prototype, key, descriptor);
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

function dragEvent(target, types, fields = {}) {
  return {
    target,
    clientX: 30,
    clientY: 40,
    relatedTarget: null,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
    dataTransfer: {
      types,
      items: types.includes("Files") ? [{ kind: "file" }] : [],
      files: types.includes("Files") ? [{ name: "a.txt" }] : [],
      getData: (type) => (type === "text/plain" && types.includes(type) ? "dropped words" : ""),
    },
    ...fields,
  };
}

test("DOM URLs and text stay distinct from native files", () => {
  assert.deepEqual(parseUriList("# comment\r\nhttps://a.test/\n\n  https://b.test/x  \n"), ["https://a.test/", "https://b.test/x"]);
  assert.deepEqual(domDropItems({ uriList: "https://a.test/\nfile:///etc/passwd", text: "https://a.test/" }), [{ kind: "url", url: "https://a.test/" }]);
  assert.deepEqual(domDropItems({ uriList: "file:///home/me/a.txt", text: "file:///home/me/a.txt" }), []);
  assert.deepEqual(domDropItems({ uriList: "", text: "  ardia.dev  " }), [{ kind: "text", text: "ardia.dev" }]);
  assert.deepEqual(domDropItems({ uriList: "", text: "x".repeat(9000) }), []);
  assert.equal(domDropItems({ uriList: Array.from({ length: 80 }, (_, n) => `https://a.test/${n}`).join("\n"), text: "" }).length, 50);
  assert.equal(acceptsDrag(["Files"]), true);
  assert.equal(acceptsDrag(["text/html"]), false);
  assert.equal(dragCount(["Files"], 3), 3);
  assert.equal(dragCount(["text/uri-list", "text/plain"], 0), 1);
  assert.equal(dragCount(["text/html"], 0), 0);
  assert.equal(validFileUrl("file:///home/me/a%20b.txt"), true);
  for (const bad of ["file://host/x", "https://a.test/", "file:////x", 7]) assert.equal(validFileUrl(bad), false);
});

test("enter, move, exit and drop arrive in order with element coordinates and claimed native files", async () => {
  const updates = [];
  const claims = [];
  const drop = createDropController((u) => updates.push(u), async (names) => {
    claims.push(names);
    return ["file:///home/me/a.txt", "javascript:alert(1)", "file:///home/me/b%20c.png"];
  });
  drop.over({ x: 10, y: 5 }, 2);
  drop.over({ x: 10, y: 5 }, 2);
  drop.over({ x: 12, y: 6 }, 2);
  drop.leave();
  drop.leave();
  drop.over({ x: 1, y: 1 }, 2);
  await drop.drop({ x: 3, y: 4 }, { uriList: "https://a.test/", text: "", fileNames: ["a.txt", "b c.png"] });
  assert.deepEqual(updates.map((u) => u.phase), ["enter", "move", "exit", "enter", "drop"]);
  assert.deepEqual(updates[1], { phase: "move", x: 12, y: 6, count: 2, items: [] });
  assert.deepEqual(claims, [["a.txt", "b c.png"]]);
  const last = updates.at(-1);
  assert.deepEqual(last, {
    phase: "drop", x: 3, y: 4, count: 3,
    items: [{ kind: "file", url: "file:///home/me/a.txt" }, { kind: "file", url: "file:///home/me/b%20c.png" }, { kind: "url", url: "https://a.test/" }],
  });
  assert.ok(last.items.filter((item) => item.kind === "file").every((item) => /^file:\/\/\/[^/]/i.test(item.url)));
  assert.equal(drop.inside, false);
});

test("a refused or failing native claim still delivers DOM items and never invents files", async () => {
  for (const claim of [async () => { throw Object.assign(new Error("No matching desktop file drop is pending"), { code: "ERR_NO_FILE_DROP" }); }, async () => "nope", async () => null]) {
    const updates = [];
    const drop = createDropController((u) => updates.push(u), claim);
    drop.over({ x: 0, y: 0 }, 1);
    await drop.drop({ x: 0, y: 0 }, { uriList: "", text: "hello", fileNames: ["a.txt"] });
    assert.deepEqual(updates.at(-1).items, [{ kind: "text", text: "hello" }]);
  }
  const updates = [];
  let claimed = false;
  const drop = createDropController((u) => updates.push(u), async () => { claimed = true; return []; });
  await drop.drop({ x: 0, y: 0 }, { uriList: "https://a.test/", text: "", fileNames: [] });
  assert.equal(claimed, false);
  assert.deepEqual(updates.map((u) => u.phase), ["enter", "drop"]);
});

test("outbound file drags start once past the threshold with the primary button and suppress the click", () => {
  const begun = [];
  const gesture = createFileDragGesture((path) => begun.push(path));
  gesture.down({ x: 0, y: 0, pointerId: 1, button: 0 }, "/home/me/Downloads/a.zip");
  assert.equal(gesture.move({ x: FILE_DRAG_THRESHOLD - 1, y: 0, pointerId: 1, buttons: 1 }), false);
  assert.equal(gesture.move({ x: 0, y: 0, pointerId: 2, buttons: 1 }), false);
  assert.equal(gesture.move({ x: FILE_DRAG_THRESHOLD, y: 1, pointerId: 1, buttons: 1 }), true);
  assert.equal(gesture.move({ x: 40, y: 40, pointerId: 1, buttons: 1 }), false);
  assert.deepEqual(begun, ["/home/me/Downloads/a.zip"]);
  assert.equal(gesture.consumeClick(), true);
  assert.equal(gesture.consumeClick(), false);
  gesture.down({ x: 0, y: 0, pointerId: 1, button: 2 }, "/home/me/Downloads/a.zip");
  assert.equal(gesture.move({ x: 20, y: 0, pointerId: 1, buttons: 2 }), false);
  gesture.down({ x: 0, y: 0, pointerId: 1, button: 0 }, null);
  assert.equal(gesture.move({ x: 20, y: 0, pointerId: 1, buttons: 1 }), false);
  gesture.down({ x: 0, y: 0, pointerId: 1, button: 0 }, "/a");
  assert.equal(gesture.move({ x: 1, y: 0, pointerId: 1, buttons: 0 }), false);
  assert.equal(gesture.move({ x: 20, y: 0, pointerId: 1, buttons: 1 }), false);
  gesture.down({ x: 0, y: 0, pointerId: 1, button: 0 }, "/a");
  gesture.up();
  assert.equal(gesture.move({ x: 20, y: 0, pointerId: 1, buttons: 1 }), false);
  assert.equal(gesture.consumeClick(), false);
  assert.equal(begun.length, 1);
});

test("a text drag over a text field inside a drop area is left to the field, while file drags and the rest of the area still drop", async () => {
  const updates = [];
  const area = new FakeElement();
  const row = new FakeElement({ parent: area });
  const field = new FakeElement({ parent: row, editable: true });
  const stop = watchDropArea(area, createDropController((u) => updates.push(u), async () => ["file:///home/me/a.txt"]), () => true);
  assert.equal(area.dispatch("dragover", dragEvent(row, ["text/plain"])).prevented, true);
  assert.equal(area.dispatch("dragover", dragEvent(field, ["text/plain"])).prevented, false);
  assert.equal(area.dispatch("drop", dragEvent(field, ["text/plain"])).prevented, false);
  await settle();
  assert.deepEqual(updates.map((u) => u.phase), ["enter", "exit"]);
  assert.equal(area.dispatch("dragover", dragEvent(field, ["Files"])).prevented, true);
  assert.equal(area.dispatch("drop", dragEvent(field, ["Files"])).prevented, true);
  await settle();
  assert.deepEqual(updates.map((u) => u.phase), ["enter", "exit", "enter", "drop"]);
  assert.deepEqual(updates.at(-1).items, [{ kind: "file", url: "file:///home/me/a.txt" }]);
  stop();
});

test("a drop area that unmounts in the middle of a drag reports the drag leaving, once", () => {
  const updates = [];
  const area = new FakeElement();
  const stop = watchDropArea(area, createDropController((u) => updates.push(u), async () => []), () => true);
  area.dispatch("dragenter", dragEvent(area, ["text/uri-list"]));
  stop();
  assert.deepEqual(updates.map((u) => u.phase), ["enter", "exit"]);
  assert.equal(area.listening, 0);
  const idle = watchDropArea(area, createDropController((u) => updates.push(u), async () => []), () => true);
  idle();
  assert.equal(updates.length, 2);
});

function pointerHarness(path = "/home/me/Downloads/a.zip") {
  const previous = globalThis.window;
  const win = new FakeTarget();
  globalThis.window = win;
  const row = new FakeElement();
  const begun = [];
  const stop = watchFileDragArea(row, () => path, (p) => begun.push(p));
  const pointer = (x, fields = {}) => ({ clientX: x, clientY: 0, pointerId: 1, button: 0, buttons: 1, prevented: false, preventDefault() { this.prevented = true; }, ...fields });
  return {
    win, row, begun,
    down: (fields) => row.dispatch("pointerdown", pointer(0, fields)),
    move: (x, fields) => win.dispatch("pointermove", pointer(x, fields)),
    up: () => win.dispatch("pointerup", pointer(0, { buttons: 0 })),
    click: () => row.dispatch("click", { prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } }),
    stop: () => { stop(); globalThis.window = previous; },
  };
}

test("a file drag keeps tracking after the pointer leaves the row before the threshold, and lets go of the window afterwards", () => {
  const h = pointerHarness();
  h.down();
  assert.equal(h.win.listening, 3);
  assert.equal(h.move(FILE_DRAG_THRESHOLD - 1).prevented, false);
  assert.equal(h.move(FILE_DRAG_THRESHOLD + 30).prevented, true);
  assert.deepEqual(h.begun, ["/home/me/Downloads/a.zip"]);
  assert.equal(h.win.listening, 0);
  assert.equal(h.click().prevented, true);
  assert.equal(h.click().prevented, false);
  h.stop();
});

test("a press released anywhere, a release seen only as a buttonless move, or a non-primary press never starts a file drag", () => {
  const h = pointerHarness();
  h.down();
  h.up();
  assert.equal(h.win.listening, 0);
  h.move(40);
  h.down();
  h.move(1, { buttons: 0 });
  assert.equal(h.win.listening, 0);
  h.down({ button: 2, buttons: 2 });
  assert.equal(h.win.listening, 0);
  h.down();
  h.stop();
  assert.equal(h.win.listening, 0);
  assert.equal(h.row.listening, 0);
  assert.deepEqual(h.begun, []);
});
