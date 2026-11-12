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

test("a block taller than the window is offered cut to what shows, but Arc's pick stays the default", () => {
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
