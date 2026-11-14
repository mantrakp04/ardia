import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../../../../packages/ardiacore/ios/capture_target.js", import.meta.url), "utf8");

function element(tagName, [left, top, width, height], style = {}) {
  const node = {
    tagName,
    shadowRoot: null,
    root: null,
    style: { display: "block", visibility: "visible", opacity: "1", backgroundImage: "none", ...style },
    getBoundingClientRect: () => ({ left, top, width, height, right: left + width, bottom: top + height }),
    getRootNode: () => node.root,
  };
  return node;
}

const contains = (node, x, y) => {
  const r = node.getBoundingClientRect();
  return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
};

const area = (node) => {
  const r = node.getBoundingClientRect();
  return r.width * r.height;
};

function root(nodes) {
  const tree = { elementsFromPoint: (x, y) => nodes.filter((n) => contains(n, x, y)).sort((a, b) => area(a) - area(b)) };
  for (const node of nodes) node.root = tree;
  return tree;
}

function pick(nodes, [x, y], { width = 1280, height = 800, dpr = 2, backing = 2, visual } = {}) {
  let reply = null;
  const window = {
    innerWidth: width,
    innerHeight: height,
    devicePixelRatio: dpr,
    visualViewport: visual ?? { scale: 1, offsetLeft: 0, offsetTop: 0, width, height },
  };
  const document = root(nodes);
  const run = new Function("window", "document", "getComputedStyle", "post", `return (${source});`)(window, document, (n) => n.style, (kind, json) => {
    if (kind === "result") reply = JSON.parse(json);
  });
  run(x, y, backing);
  return reply;
}

const page = () => {
  const html = element("HTML", [0, 0, 1280, 3000]);
  const body = element("BODY", [0, 0, 1280, 3000]);
  const section = element("SECTION", [264, 209, 752, 526]);
  const infobox = element("TABLE", [706, 209, 310, 829], { display: "table" });
  const image = element("IMG", [791, 260, 140, 116], { display: "inline" });
  const text = element("SPAN", [300, 300, 200, 20], { display: "inline" });
  return { html, body, section, infobox, image, text, all: [html, body, section, infobox, image, text] };
};

test("an inline image wins over the section around it", () => {
  const { all } = page();
  const reply = pick(all, [831, 300]);
  assert.deepEqual(reply.candidates[reply.best], [791, 260, 140, 116]);
});

test("a block taller than the window is offered cut to what shows, but the section stays the default pick", () => {
  const { all } = page();
  const reply = pick(all, [800, 600]);
  assert.deepEqual(reply.candidates, [[706, 209, 310, 591], [264, 209, 752, 526]]);
  assert.equal(reply.best, 1);
});

test("plain text gives the biggest card around it, never the whole page", () => {
  const { all } = page();
  const reply = pick(all, [350, 305]);
  assert.deepEqual(reply.candidates, [[264, 209, 752, 526]]);
  assert.equal(reply.best, 0);
});

test("a spot with only page-sized boxes offers nothing to click", () => {
  const { html, body } = page();
  const reply = pick([html, body], [100, 100]);
  assert.deepEqual(reply, { candidates: [], best: -1 });
});

test("a content column running past the window isn't the default pick", () => {
  const { html, body, section, text } = page();
  const column = element("DIV", [264, 120, 1000, 2800]);
  const reply = pick([html, body, column, section, text], [350, 305]);
  assert.deepEqual(reply.candidates[reply.best], [264, 209, 752, 526]);
  assert.ok(reply.candidates.some((box) => box[3] === 680), JSON.stringify(reply.candidates));
});

test("page zoom maps CSS pixels to view points", () => {
  const card = element("DIV", [100, 100, 200, 160]);
  const reply = pick([card], [150, 150], { dpr: 2.5, backing: 2, width: 1024, height: 640 });
  assert.deepEqual(reply.candidates[reply.best], [125, 125, 250, 200]);
});

test("pinch zoom maps the visual viewport", () => {
  const card = element("DIV", [300, 200, 200, 200]);
  const visual = { scale: 2, offsetLeft: 250, offsetTop: 150, width: 640, height: 400 };
  const reply = pick([card], [200, 200], { visual });
  assert.deepEqual(reply.candidates[reply.best], [100, 100, 400, 400]);
});

test("open shadow roots are searched", () => {
  const host = element("APP-CARD", [100, 100, 400, 300]);
  const inner = element("IMG", [120, 120, 200, 150]);
  host.shadowRoot = root([inner]);
  const document = [host];
  const reply = pick(document, [150, 150]);
  assert.deepEqual(reply.candidates[reply.best], [120, 120, 200, 150]);
});

function frame(rect, inside, { scale = 1 } = {}) {
  const node = element("IFRAME", rect.map((v, i) => (i >= 2 ? v * scale : v)), { display: "inline" });
  Object.assign(node, { contentDocument: root(inside), clientLeft: 0, clientTop: 0, clientWidth: rect[2], clientHeight: rect[3], offsetWidth: rect[2], offsetHeight: rect[3] });
  return node;
}

test("a block inside a frame is offered, cut to the frame", () => {
  const tallChild = element("ARTICLE", [10, 10, 280, 900]);
  const host = frame([100, 100, 300, 200], [tallChild]);
  const reply = pick([host], [150, 150]);
  assert.deepEqual(reply.candidates[0], [110, 110, 280, 190]);
});

test("a scaled frame is offered as a whole, never what's inside", () => {
  const child = element("IMG", [0, 0, 300, 200]);
  const host = frame([100, 100, 300, 200], [child], { scale: 0.5 });
  const reply = pick([host], [150, 150]);
  assert.deepEqual(reply.candidates, [[100, 100, 150, 100]]);
});

test("boxes drawn at the same place are offered once", () => {
  const outer = element("DIV", [100, 100, 300, 200]);
  const inner = element("DIV", [100, 100, 300, 200]);
  const reply = pick([outer, inner], [150, 150]);
  assert.equal(reply.candidates.length, 1);
});

test("hidden and tiny boxes are skipped", () => {
  const hidden = element("DIV", [100, 100, 300, 200], { visibility: "hidden" });
  const tiny = element("DIV", [100, 100, 10, 10]);
  const reply = pick([hidden, tiny], [105, 105]);
  assert.deepEqual(reply, { candidates: [], best: -1 });
});

test("blocks in a shadow root inside another shadow root are offered", () => {
  const page = element("APP-PAGE", [50, 50, 800, 600]);
  const card = element("APP-CARD", [100, 100, 400, 300]);
  const image = element("IMG", [120, 120, 200, 150]);
  card.shadowRoot = root([image]);
  page.shadowRoot = root([card]);
  const reply = pick([page], [150, 150]);
  assert.deepEqual(reply.candidates[reply.best], [120, 120, 200, 150]);
});

test("a frame inside a shadow root is searched", () => {
  const article = element("ARTICLE", [10, 10, 200, 150]);
  const host = element("APP-EMBED", [100, 100, 400, 300]);
  host.shadowRoot = root([frame([100, 100, 300, 200], [article])]);
  const reply = pick([host], [150, 150]);
  assert.deepEqual(reply.candidates[0], [110, 110, 200, 150]);
});

test("a block cut by a container that hides its overflow is offered cut to it", () => {
  const card = element("DIV", [100, 100, 300, 200], { overflowX: "hidden", overflowY: "hidden" });
  const image = element("IMG", [40, 60, 600, 400]);
  image.parentElement = card;
  const reply = pick([card, image], [150, 150]);
  assert.deepEqual(reply.candidates, [[100, 100, 300, 200]]);
});

test("an absolutely placed box isn't cut by a static container that hides its overflow", () => {
  const clipper = element("DIV", [100, 100, 200, 100], { overflowX: "hidden", overflowY: "hidden" });
  const popup = element("DIV", [100, 100, 400, 300], { position: "absolute" });
  popup.parentElement = clipper;
  const reply = pick([clipper, popup], [150, 150]);
  assert.ok(reply.candidates.some((box) => box[2] === 400 && box[3] === 300), JSON.stringify(reply.candidates));
});

test("a container that clips only one direction cuts the block only that way", () => {
  const strip = element("DIV", [100, 100, 300, 200], { overflowX: "clip", overflowY: "visible" });
  const poster = element("DIV", [120, 50, 600, 400]);
  poster.parentElement = strip;
  const reply = pick([strip, poster], [150, 150]);
  assert.ok(reply.candidates.some((box) => box.join() === [120, 50, 280, 400].join()), JSON.stringify(reply.candidates));
});
