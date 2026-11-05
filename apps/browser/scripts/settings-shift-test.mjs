import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { attach, launch, reporter } from "../../../scripts/lib/instance.mjs";

const HELP = `usage: node settings-shift-test.mjs <Debug Ardia.app> [--port N] [--attach <data dir>] [--panes a,b] [--keep]

Opens Settings in a hidden instance and switches to every pane, the first one right after the window opens.
For each pane it records every view's frame, every text and every switch's value on the first frame the pane
is on screen and again once it has settled, and fails when anything moved, appeared, disappeared or changed.
Then it checks Settings search: ⌘F focuses the field, typing finds the row, Return opens its pane, scrolls the
row into view and highlights it, Escape clears the field.`;

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: { port: { type: "string" }, attach: { type: "string" }, panes: { type: "string" }, keep: { type: "boolean" }, help: { type: "boolean", short: "h" } },
});
if (flags.help || (!positionals[0] && !flags.attach)) {
  console.log(HELP);
  process.exit(flags.help ? 0 : 2);
}

const PANES = (flags.panes ?? "general,profiles,sync,tabs,appearance,privacy,passwords,autofill,extensions,search,shortcuts,liveFolders,calendar,advanced").split(",");
const SETTLE_MS = 1200;

const scratch = flags.attach ? null : mkdtempSync(join(tmpdir(), "ac-settings-shift-"));
const data = flags.attach ? resolve(flags.attach) : join(scratch, "data");
if (scratch) mkdirSync(data);
const rep = reporter(join(flags.attach ?? scratch, "settings-shift-test.log"), { name: "settings-shift-test" });

const PROBE = `
const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
const roots = () => [...hook.renderers.keys()].flatMap((id) => [...hook.getFiberRoots(id)].map((r) => r.current));
const nameOf = (f) => (typeof f.type === "string" ? f.type : f.type?.displayName || f.type?.name || f.type?.render?.name || "");
const findPane = () => {
  for (const root of roots()) {
    const stack = [root];
    while (stack.length) {
      const f = stack.pop();
      if (nameOf(f) === "Pane" && f.memoizedProps?.pane) return f;
      for (let c = f.child; c; c = c.sibling) stack.push(c);
    }
  }
  return null;
};
const capture = (pane) => {
  const views = [];
  const texts = [];
  const switches = [];
  const walk = (f, path) => {
    const name = nameOf(f);
    if (name === "Switch") switches.push([path, !!f.memoizedProps?.value]);
    if (name === "RCTRawText") texts.push([path, String(f.memoizedProps?.text ?? "")]);
    if (typeof f.type === "string" && typeof f.stateNode?.measureInWindow === "function") views.push([path, f.stateNode]);
    let i = 0;
    for (let c = f.child; c; c = c.sibling) walk(c, path + "/" + (nameOf(c) || "?") + (c.key != null ? "#" + c.key : ":" + i++));
  };
  walk(pane, "Pane");
  return Promise.all(
    views.map(([path, node]) => new Promise((resolve) => {
      const timer = setTimeout(() => resolve([path, null]), 1000);
      node.measureInWindow((x, y, w, h) => { clearTimeout(timer); resolve([path, [x, y, w, h].map((v) => Math.round(v * 2) / 2)]); });
    })),
  ).then((frames) => ({ frames, texts, switches }));
};
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const firstFrameOf = (pane, deadline) => nextFrame().then(() => {
  const f = findPane();
  if (f && f.memoizedProps.pane === pane) return f;
  if (Date.now() > deadline) throw new Error("the " + pane + " pane never appeared");
  return firstFrameOf(pane, deadline);
});
`;

const switchTo = (pane, from, idleMs) => `${PROBE}
const t0 = Date.now();
ac.openSettings(${JSON.stringify(from)});
return new Promise((r) => setTimeout(r, ${idleMs})).then(() => {
  const asked = Date.now();
  ac.openSettings(${JSON.stringify(pane)});
  return firstFrameOf(${JSON.stringify(pane)}, Date.now() + 3000).then((fiber) => {
    const shownAfter = Date.now() - asked;
    return capture(fiber).then((first) =>
      new Promise((r) => setTimeout(r, ${SETTLE_MS})).then(() => capture(findPane())).then((settled) => ({ shownAfter, first, settled })),
    );
  });
});`;

function compare({ first, settled }) {
  const problems = [];
  const a = new Map(first.frames);
  const b = new Map(settled.frames);
  for (const [path, frame] of a) {
    if (!b.has(path)) problems.push(`disappeared: ${path}`);
    else if (frame && b.get(path) && frame.some((v, i) => Math.abs(v - b.get(path)[i]) > 0.5)) problems.push(`moved: ${path} ${frame.join(",")} -> ${b.get(path).join(",")}`);
  }
  for (const path of b.keys()) if (!a.has(path)) problems.push(`appeared: ${path}`);
  const ta = new Map(first.texts);
  for (const [path, text] of settled.texts) if (ta.has(path) && ta.get(path) !== text) problems.push(`text changed: ${JSON.stringify(ta.get(path))} -> ${JSON.stringify(text)}`);
  const sa = new Map(first.switches);
  for (const [path, on] of settled.switches) if (sa.has(path) && sa.get(path) !== on) problems.push(`switch changed: ${path} ${sa.get(path)} -> ${on}`);
  return problems;
}

const SEARCH = (query, id, downs = 0) => `
const s = ac.settingsSearch;
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = (test, ms) => { const end = Date.now() + ms; const loop = () => (test() ? Promise.resolve(true) : Date.now() > end ? Promise.resolve(false) : nextFrame().then(loop)); return loop(); };
ac.openSettings("general");
const before = s.useSettingsSearch.getState().focusRequest;
return wait(400)
  .then(() => ac.shell.devKeyEquivalent("settings", { key: "f", keyCode: 3, modifiers: ["command"], asKey: true }))
  .then(() => until(() => s.useSettingsSearch.getState().focusRequest !== before, 2000))
  .then((focused) => {
    if (!focused) throw new Error("⌘F didn't focus the search field");
    return wait(150).then(() => ac.shell.devTypeKeys("settings", ${JSON.stringify(query)}, 15));
  })
  .then(() => until(() => s.useSettingsSearch.getState().query === ${JSON.stringify(query)}, 2000))
  .then((typed) => {
    if (!typed) throw new Error("typing didn't reach the search field: " + JSON.stringify(s.useSettingsSearch.getState().query));
    const results = s.settingsResults(${JSON.stringify(query)}, new Set()).map((e) => e.id);
    if (results[${downs}] !== ${JSON.stringify(id)}) throw new Error("result ${downs + 1} is " + results[${downs}] + ", not ${id}");
    const press = (key, keyCode) => ac.shell.devKeyEquivalent("settings", { key, keyCode, modifiers: [], send: true, asKey: true, wait: 30 });
    const downs = Array.from({ length: ${downs} }).reduce((p) => p.then(() => press("\\uF701", 125)), Promise.resolve());
    const asked = Date.now();
    return downs
      .then(() => press("\\r", 36))
      .then(() => until(() => (s.useSettingsSearch.getState().flash?.at ?? 0) >= asked, 3000))
      .then(() => results);
  })
  .then((results) => {
    const flash = s.useSettingsSearch.getState().flash;
    if (flash?.id !== ${JSON.stringify(id)}) throw new Error("highlighted " + JSON.stringify(flash) + " instead of ${id}");
    const view = s.anchorView(${JSON.stringify(id)});
    return new Promise((r) => view.measureInWindow((x, y, w, h) => r([x, y, w, h]))).then((frame) => ({ results, frame, nav: ac.settingsNav.getState().pane }));
  })
  .then((out) =>
    ac.shell.devKeyEquivalent("settings", { key: "\\u001b", keyCode: 53, modifiers: [], send: true, asKey: true, wait: 30 })
      .then(() => wait(200))
      .then(() => ({ ...out, cleared: s.useSettingsSearch.getState().query === "" })),
  );`;

let app;
try {
  app = flags.attach
    ? attach(data)
    : await launch(resolve(positionals[0]), { data, port: flags.port, onboarded: true, ready: "return !!ac.openSettings" });
  const ac = (body) => app.eval(body, { timeout: 60000 });

  await ac(`
    return Promise.all([
      ac.engine.call("sites.setZoom", { profile: "", host: "example.com", zoom: 1.25 }),
      ac.engine.call("sites.setSetting", { profile: "", engine: "chromium", origin: "https://example.com", type: "notifications", value: "block" }),
    ]).then(() => true, (e) => String(e));
  `);

  let from = "general";
  for (const [i, pane] of PANES.entries()) {
    const source = pane === from ? (pane === "general" ? "tabs" : "general") : from;
    await rep.check(`${pane}${i === 0 ? " (right after opening)" : ""}`, async () => {
      const result = await ac(switchTo(pane, source, i === 0 ? 0 : 500));
      const problems = compare(result);
      if (problems.length) throw new Error([`${problems.length} changes after the first frame (shown ${result.shownAfter} ms after the click)`, ...problems.slice(0, 15)].join("\n"));
      return `${result.first.frames.length} views, ${result.first.switches.length} switches, shown after ${result.shownAfter} ms, nothing changed`;
    });
    from = pane;
  }

  for (const [query, id, downs] of [["cookies", "privacy.blockCookieBanners", 0], ["dark", "appearance.theme", 0], ["licenses", "advanced.licenses", 0], ["password", "passwords.offerToSave", 1]]) {
    await rep.check(`search "${query}"${downs ? ` ↓×${downs}` : ""} opens ${id}`, async () => {
      const out = await ac(SEARCH(query, id, downs));
      const [, y, , h] = out.frame;
      if (out.nav !== id.split(".")[0]) throw new Error(`opened ${out.nav}`);
      if (!(y >= 52 && y + h <= 640)) throw new Error(`row isn't in view: y ${y}, height ${h}`);
      if (!out.cleared) throw new Error("Escape didn't clear the field");
      return `${out.results.length} results, row at y ${y}`;
    });
  }
} catch (error) {
  rep.record("setup", { error });
} finally {
  if (!flags.attach && !flags.keep) await app?.quit();
}
const passed = rep.summary();
if (!flags.attach && !flags.keep) rmSync(scratch, { recursive: true, force: true });
process.exit(passed ? 0 : 1);
