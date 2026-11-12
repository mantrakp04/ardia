import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
const { translatorCall } = await import("./pageTranslator.ts");

class FakeNode {
  parentNode = null;
  childNodes = [];
  get parentElement() {
    return this.parentNode?.nodeType === 1 ? this.parentNode : null;
  }
  get isConnected() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node.isRoot === true;
  }
}
class FakeText extends FakeNode {
  nodeType = 3;
  constructor(value) {
    super();
    this.nodeValue = value;
  }
}
class FakeElement extends FakeNode {
  nodeType = 1;
  constructor(tag, children = []) {
    super();
    this.tagName = tag.toUpperCase();
    for (const child of children) {
      child.parentNode = this;
      this.childNodes.push(child);
    }
  }
  closest(selector) {
    const tags = selector.split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9]+$/.test(s));
    for (let node = this; node && node.nodeType === 1; node = node.parentNode) if (tags.includes(node.tagName)) return node;
    return null;
  }
  getBoundingClientRect() {
    return { top: 0, bottom: 20, width: 100, height: 20 };
  }
}

function fakePage(body) {
  const html = new FakeElement("html", [body]);
  html.isRoot = true;
  const descendants = (root) => root.childNodes.flatMap((child) => [child, ...descendants(child)]);
  const results = [];
  const context = {
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4 },
    innerHeight: 800,
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    document: {
      body,
      documentElement: html,
      createTreeWalker(root, show) {
        const nodes = descendants(root).filter((n) => (n.nodeType === 3 ? show & 4 : show & 1));
        let i = 0;
        return { nextNode: () => nodes[i++] ?? null };
      },
    },
    post: (_kind, json) => results.push(JSON.parse(json)),
  };
  context.window = context;
  vm.createContext(context);
  const call = (op, ...args) => {
    vm.runInContext(`{\n${translatorCall(op, ...args)}\n}`, context);
    return results.pop();
  };
  return { call };
}

test("the page hands over no more passages than asked for and keeps the rest of a big block queued", () => {
  const texts = Array.from({ length: 360 }, (_, i) => new FakeText(`Sentence number ${i}. `));
  const page = fakePage(new FakeElement("body", [new FakeElement("p", texts)]));
  assert.equal(page.call("start", "t1"), true);
  const seen = new Set();
  let batch = page.call("next", "t1", 2, 100000);
  assert.equal(batch.passages.length, 2);
  assert.equal(batch.more, true);
  for (;;) {
    assert.ok(batch.passages.length <= 2);
    for (const [, pieces] of batch.passages) for (const [, text] of pieces) seen.add(text);
    if (!batch.more) break;
    batch = page.call("next", "t1", 2, 100000);
  }
  assert.equal(seen.size, 360);
});

test("an answer for an earlier translation of the page is ignored", () => {
  const text = new FakeText("Hello there");
  const page = fakePage(new FakeElement("body", [new FakeElement("p", [text])]));
  page.call("start", "old");
  const [[, [[id]]]] = page.call("next", "old", 2, 2000).passages;
  page.call("revert");
  page.call("start", "new");
  assert.equal(page.call("apply", "old", [[id, "Bonjour"]]), false);
  assert.equal(text.nodeValue, "Hello there");
  const [[, [[fresh]]]] = page.call("next", "new", 2, 2000).passages;
  assert.equal(page.call("apply", "new", [[fresh, "Salut"]]), true);
  assert.equal(text.nodeValue, "Salut");
});
