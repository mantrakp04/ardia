import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const ios = new URL("../ios/", import.meta.url);

const withoutComments = (text) => {
  let code = "";
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' || char === "'") {
      let end = i + 1;
      while (end < text.length && text[end] !== char && text[end] !== "\n") end += text[end] === "\\" ? 2 : 1;
      code += text.slice(i, end + 1);
      i = end + 1;
    } else if (char === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (char === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
    } else {
      code += char;
      i++;
    }
  }
  return code;
};
const native = (file) => withoutComments(readFileSync(new URL(file, ios), "utf8"));

const bodyOf = (text, signature) => {
  const start = text.indexOf(signature);
  assert.ok(start >= 0, `${signature} is in the source`);
  const open = text.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}" && --depth === 0) return text.slice(open, i + 1);
  }
  assert.fail(`${signature} has no closing brace`);
};

const marks = (tab) => `[ArdiaTabRegistry expectFirstShowFocus:YES forTab:${tab}];`;
const unmarks = (tab) => `[ArdiaTabRegistry expectFirstShowFocus:NO forTab:${tab}];`;

test("a mark that is only commented out does not count", () => {
  const commented = `// ${marks("tab")}\n/* ${marks("tab")}\n */\nreturn @"http://example.test"; // ${marks("tab")}\n`;
  const code = withoutComments(commented);
  assert.ok(!code.includes(marks("tab")), "no mark survives in the stripped source");
  assert.ok(code.includes('@"http://example.test"'), "a URL in a string keeps its slashes");
});

test("slashes inside a string do not hide a mark that follows on the same line", () => {
  for (const literal of ['@"a//b"', '@"a/*b"', '@"say \\"//\\" now"', "'/'"]) {
    const line = `[log ${literal}]; ${marks("tab")}\n`;
    const code = withoutComments(line);
    assert.ok(code.includes(literal), `${literal} is kept whole`);
    assert.ok(code.includes(marks("tab")), `the mark after ${literal} survives`);
  }
  const trailing = withoutComments(`[log @"a//b"]; // ${marks("tab")}\nnext;\n`);
  assert.ok(!trailing.includes(marks("tab")), "a comment after a string still hides the mark");
  assert.ok(trailing.includes("next;"), "the next line is kept");
});

test("the request belongs to the tab, not to a view or its focus state", () => {
  const state = bodyOf(native("ArdiaWebViewInternal.h"), "struct ArdiaPageFocusState");
  assert.ok(!state.includes("onFirstShow"), "the focus state of a view does not hold the request");
  const header = native("ArdiaTabRegistry.h");
  assert.match(header, /\+ \(void\)expectFirstShowFocus:\(BOOL\)expects forTab:\(ArdiaCoreTab \*\)tab;/);
  assert.match(header, /\+ \(BOOL\)takeFirstShowFocusOfTab:\(ArdiaCoreTab \*\)tab;/);
});

test("the registry keeps the requests in a weak table and forgets a tab's request with the tab", () => {
  const registry = native("ArdiaTabRegistry.mm");
  assert.match(registry, /NSHashTable<ArdiaCoreTab \*> \*AwaitingFirstShowFocus\(\) \{\s*static NSHashTable \*tabs = \[NSHashTable weakObjectsHashTable\];/);
  const take = bodyOf(registry, "+ (BOOL)takeFirstShowFocusOfTab:");
  assert.match(take, /if \(!\[AwaitingFirstShowFocus\(\) containsObject:tab\]\) return NO;/);
  assert.match(take, /\[AwaitingFirstShowFocus\(\) removeObject:tab\];\s*return YES;/);
  const forget = bodyOf(registry, "+ (void)forget:");
  assert.match(forget, /\[AwaitingFirstShowFocus\(\) removeObject:tab\];/);
});

const offeredBranch = () => {
  const ensure = bodyOf(native("ArdiaWebView+Transfer.mm"), "- (void)ensureTab {");
  return ensure.slice(ensure.indexOf('hasPrefix:@"ardiacore:"'));
};

test("a tab taken from an offer is marked before it is attached", () => {
  const offered = offeredBranch();
  const attach = bodyOf(offered.slice(offered.indexOf("if (offered && !offered.closed) {")), "if (offered && !offered.closed) {");
  const mark = attach.indexOf(marks("offered"));
  assert.ok(mark >= 0, "the branch that attaches the offered tab marks the tab");
  assert.ok(mark < attach.indexOf("[self attach:offered]"), "the mark comes before the attach");
});

test("an offered tab that is held is marked only once it is parked for the retry", () => {
  const offered = offeredBranch();
  const heldAt = offered.indexOf("[self holdTransferOf:offered]");
  assert.ok(heldAt >= 0, "the offered branch holds a tab the window cannot take yet");
  assert.ok(!offered.slice(0, heldAt).includes(marks("offered")), "nothing is marked before the hold is decided");
  const held = bodyOf(offered.slice(heldAt), "[self holdTransferOf:offered]");
  const parked = held.indexOf("[ArdiaTabParking park:offered forKey:_transferKey];");
  assert.ok(parked >= 0, "the held tab is parked");
  assert.ok(held.indexOf(marks("offered")) > parked, "the mark follows the park");
});

test("a parked link tab is marked before it is taken, and unmarked when it is not", () => {
  const take = bodyOf(native("ArdiaWebView+Transfer.mm"), "- (BOOL)takeLinkTab:");
  const mark = take.indexOf(marks("tab"));
  const taken = take.indexOf("[self takeTransferredTab] != ArdiaTransferNone");
  assert.ok(mark >= 0 && taken > mark, "the link tab is marked before takeTransferredTab");
  const unmark = take.indexOf(unmarks("tab"), taken);
  assert.ok(unmark > taken && unmark < take.indexOf("discardTab:tab"), "a discarded link tab leaves no mark");
});

const settle = () => bodyOf(native("ArdiaWebView+Focus.mm"), "- (void)settleFirstShowFocus {");

test("a request is consumed only once the page is attached, shown and not hidden", () => {
  const body = settle();
  const consumed = body.indexOf("[ArdiaTabRegistry takeFirstShowFocusOfTab:_tab]");
  assert.ok(consumed >= 0, "settling consumes the tab's request");
  const gate = body.slice(0, consumed);
  for (const check of ["!_tab", "!_visible", "!window", "_standalone", "page.superview != self", "page.isHiddenOrHasHiddenAncestor"])
    assert.ok(gate.includes(check), `${check} keeps the request waiting`);
  assert.match(gate, /\) return;/);
});

test("only the tab the strip shows as active takes focus, and a visible tab that is not active yet keeps its request", () => {
  const body = settle();
  const consumed = body.indexOf("[ArdiaTabRegistry takeFirstShowFocusOfTab:_tab]");
  const check = "if (!controller || [ArdiaTabStrip activeTabInWindow:controller profile:_tab.profile] != _tab) return;";
  const active = body.indexOf(check);
  const requested = body.indexOf("[self requestFocusRestoreIn:window];");
  assert.ok(active >= 0, "settling checks that the strip lists this tab as active");
  assert.ok(consumed > active, "the request is taken only after the active-tab check, so a split pane that is not active keeps it");
  assert.ok(requested > consumed, "focus is requested after the request is taken");
});

test("a request is settled when the page is attached, when the view becomes visible, when painting is applied and when it is unhidden", () => {
  const attach = bodyOf(native("ArdiaWebView+Tab.mm"), "- (void)attach:(ArdiaCoreTab *)tab {");
  assert.ok(attach.trimEnd().endsWith("[self settleFirstShowFocus];\n}"), "attach ends by settling the request");
  const visible = bodyOf(native("ArdiaWebView.mm"), "- (void)setVisible:(BOOL)visible {");
  assert.match(visible, /if \(visible\) \[self settleFirstShowFocus\];/);
  const unhide = bodyOf(native("ArdiaWebView.mm"), "- (void)viewDidUnhide {");
  assert.match(unhide, /\[super viewDidUnhide\];\s*\[self settleFirstShowFocus\];/);
  const drain = bodyOf(native("ArdiaWebView+Painting.mm"), "+ (void)drainPainting {");
  const applied = drain.lastIndexOf("[view applyPainting]");
  const settled = drain.indexOf("[view settleFirstShowFocus];");
  assert.ok(settled > applied, "a drain settles after it applied painting, which is what unhides the page");
  assert.ok(drain.indexOf("[view restoreFocusIfDue];") > settled, "the focus window is checked after the request is made");
});

test("a view that lets go of its tab does not drop the tab's request", () => {
  const detach = bodyOf(native("ArdiaWebView+Tab.mm"), "- (void)detach {");
  assert.ok(!detach.includes("FirstShow"), "detach leaves the request with the tab");
});
