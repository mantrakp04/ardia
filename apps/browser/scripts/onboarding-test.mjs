import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch, reporter, sleep } from "../../../scripts/lib/instance.mjs";

const args = process.argv.slice(2);
const appArg = args.find((a) => !a.startsWith("--"));
if (!appArg) {
  console.error("usage: node onboarding-test.mjs <Debug Ardia.app> [--port=<DevTools port>] [--keep-data]\n\nNo text field sits behind the onboarding card, where its I-beam and clicks would come through the rows, the first row's checkbox toggles on a click, another window keeps its New Tab field meanwhile, and the New Tab field is back and focused once onboarding ends, in a bar that keeps its height.");
  process.exit(2);
}
const appPath = resolve(appArg);
const port = args.find((a) => a.startsWith("--port="))?.slice(7);
const keep = args.includes("--keep-data");
const scratch = mkdtempSync(join(tmpdir(), "ac-onboarding-"));
const data = join(scratch, "data");
const rep = reporter(join(scratch, "onboarding-test.log"), { name: "onboarding-test" });

let app = null;
const HELPERS = `
const C = globalThis.expo.modules.ArdiaCEF;
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const act = (a) => C.chromeWindows().then((ws) => C.devWindow(ws.find((w) => w.hasRoot).window, a));
const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
const roots = () => [...hook.renderers.keys()].flatMap((id) => [...hook.getFiberRoots(id)].map((r) => r.current));
const nameOf = (f) => (typeof f.type === "string" ? f.type : f.type?.displayName || f.type?.name || "");
const find = (from, test) => {
  const stack = [from];
  while (stack.length) {
    const f = stack.pop();
    if (test(f)) return f;
    for (let c = f.child; c; c = c.sibling) stack.push(c);
  }
  return null;
};
const checkRow = (label) => roots().map((r) => find(r, (f) => f.memoizedProps?.accessibilityRole === "checkbox" && f.memoizedProps?.accessibilityLabel === label)).find(Boolean);
const checked = (label) => !!checkRow(label)?.memoizedProps.accessibilityState?.checked;
const checkMarkCenter = (label) => new Promise((r) => {
  const mark = find(find(checkRow(label), (f) => nameOf(f) === "CheckMark"), (f) => typeof f.stateNode?.measureInWindow === "function");
  mark.stateNode.measureInWindow((x, y, w, h) => r([Math.round(x + w / 2), Math.round(y + h / 2)]));
});
const windowsAx = () => C.chromeWindows().then((ws) => Promise.all(ws.filter((w) => w.hasRoot).map((w) => C.devWindow(w.window, "ax"))));
const barHeight = () => new Promise((r) => {
  const ntp = roots().map((root) => find(root, (f) => nameOf(f) === "NewTabPage")).find(Boolean);
  const bar = find(ntp, (f) => f.memoizedProps?.onLayout && f.memoizedProps?.style?.position === "absolute" && typeof f.stateNode?.measureInWindow === "function");
  bar.stateNode.measureInWindow((x, y, w, h) => r(h));
});
const click = ([x, y]) => act("mouse:down:" + x + "," + y).then(() => settle(70)).then(() => act("mouse:up:" + x + "," + y));
`;
const run = (body) => app.eval(`${HELPERS}\n${body}`, { timeout: 20000 });
const textFields = (ax) => ax.split("\n").filter((line) => line.trim().startsWith("AXTextField"));

try {
  app = await launch(appPath, { data, port, env: { ARDIA_ONBOARDING: "1" } });
  rep.log(`instance: pid ${app.pid}, DevTools port ${app.port}, data ${data}`);
  await app.ready({ test: "return !!globalThis.acOnboarding?.store.getState().windowId" });

  await rep.check("the home step has no text field behind its card", async () => {
    const ax = await run(`acOnboarding.store.getState().go("home"); return settle(1200).then(() => act("ax"));`);
    assert.match(ax, /AXCheckBox: Set Ardia as default browser/, "the step is on screen");
    assert.deepEqual(textFields(ax), [], "a text field behind the card takes the first row's cursor and clicks");
  });

  const label = JSON.stringify("Set Ardia as default browser");
  const toggles = "a click on the first row's checkbox toggles it";
  if (await run(`return !!checkRow(${label})?.memoizedProps.accessibilityState?.disabled;`))
    rep.record(toggles, { skip: "this build is the system's default browser, so the row is disabled" });
  else await rep.check(toggles, async () => {
    const r = await run(`const before = checked(${label}); return act("fakeActiveClicks").then(() => checkMarkCenter(${label})).then((at) => click(at).then((hit) => settle(400).then(() => ({ at, hit, before, after: checked(${label}) }))));`);
    assert.notEqual(r.after, r.before, `the click at ${r.at} reached ${r.hit}`);
    return `${r.before} -> ${r.after}`;
  });

  await rep.check("another window keeps its New Tab field during onboarding", async () => {
    const axes = await run(`const id = ac.store.getState().createWindow(); return settle(1500).then(windowsAx).then((axes) => { ac.store.getState().closeWindow(id); return settle(500).then(() => axes); });`);
    assert.equal(axes.length, 2, "two windows");
    const [onboarding, other] = /AXCheckBox: Set Ardia as default browser/.test(axes[0]) ? axes : [...axes].reverse();
    assert.deepEqual(textFields(onboarding), [], "the onboarding window");
    assert.equal(textFields(other).length, 1, "the other window's New Tab field");
  });

  await rep.check("after onboarding the New Tab field is back and focused, in a bar of the same height", async () => {
    const r = await run(`return barHeight().then((during) => { acOnboarding.finish(); return settle(1500).then(() => Promise.all([act("ax"), act("type:"), barHeight()])).then(([ax, focus, after]) => ({ ax, focus, during, after })); });`);
    assert.equal(textFields(r.ax).length, 1, "the New Tab field");
    assert.match(r.focus, /NSTextView|NSTextField/, `first responder: ${r.focus}`);
    assert.equal(r.after, r.during, "the bar's height");
    return `${r.focus}, bar ${r.during} -> ${r.after}`;
  });
} finally {
  await app?.quit();
  if (!keep) rmSync(data, { recursive: true, force: true });
  else rep.say(`data: ${data}`);
}
process.exit(rep.summary() ? 0 : 1);
