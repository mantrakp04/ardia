import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { evaluate } from "../lib/cdp.mjs";
import { findVerdict, nextActive } from "../lib/assertions.mjs";
import { startBrowser } from "../lib/flows.mjs";
import { FIND_WORD } from "../lib/fixtures.mjs";
import { js, nonce, until } from "../lib/util.mjs";

const DEVTOOLS = (t) => t.url.startsWith("devtools://") || t.url.startsWith("chrome-devtools://");

async function filesIn(dirs, test) {
  const found = [];
  for (const dir of dirs) {
    for (const name of await readdir(dir).catch(() => [])) if (test(name)) found.push(join(dir, name));
  }
  return found;
}

async function openSplit(shell, fixtures, run) {
  const urlA = fixtures.url.find(3, `a-${run}`);
  const urlB = fixtures.url.find(5, `b-${run}`);
  const tabA = await shell.newTab(urlA);
  await shell.waitTabUrl(tabA, (url) => url === urlA, { label: "pane A to load" });
  const result = await shell.state(`return s.openSplitPane(windowId, { url: ${js(urlB)}, anchorTabId: ${js(tabA)}, side: "right" });`);
  if (!result?.ok) throw new Error(`openSplitPane failed: ${JSON.stringify(result)}`);
  const tabB = result.tabId;
  await shell.waitTabUrl(tabB, (url) => url === urlB, { label: "pane B to load" });
  const targets = await Promise.all([urlA, urlB].map((url) => shell.app.pageLoaded(url)));
  return { tabA, tabB, urlA, urlB, targetA: targets[0], targetB: targets[1] };
}

async function focusPane(shell, tabId) {
  return until(async () => {
    if ((await shell.activeTabId()) !== tabId) await shell.state(`s.activate(${js(tabId)}); return true;`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    return (await shell.activeTabId()) === tabId;
  }, { timeout: 8000, label: `pane ${tabId} to stay active` });
}

const findState = (shell, tabId) => shell.state(`return s.find[${js(tabId)}] ?? null;`);

async function findOnPane(shell, tabId, expected) {
  await shell.state(`s.activate(${js(tabId)}); s.setFind(${js(tabId)}, { open: true, query: ${js(FIND_WORD)}, focusRequest: Date.now() }); return true;`);
  const find = await until(async () => {
    const f = await findState(shell, tabId);
    return f?.count === expected && f.active >= 1 ? f : false;
  }, { timeout: 15000, label: `find count ${expected} on ${tabId}` });
  const verdict = findVerdict(find, expected);
  if (!verdict.ok) throw new Error(verdict.problem);
  const steps = [];
  for (const forward of [true, true, false]) {
    await focusPane(shell, tabId);
    const before = (await findState(shell, tabId)).active;
    await shell.command(forward ? "findNext" : "findPrevious");
    const want = nextActive(before, expected, forward);
    const after = await until(async () => {
      const f = await findState(shell, tabId);
      return f?.active === want ? f : false;
    }, { timeout: 8000, label: `${forward ? "next" : "previous"} match ${want} on ${tabId}` });
    steps.push({ forward, before, after: after.active });
  }
  return { count: find.count, steps };
}

async function dismissFind(shell, tabId) {
  const focusedInPane = `(() => { const field = document.activeElement; const pane = document.querySelector(${js(`[data-ardia-native-tab="${tabId}"]`)}); if (field?.getAttribute('placeholder') !== 'Find on Page' || !pane) return false; const f = field.getBoundingClientRect(), p = pane.getBoundingClientRect(); const x = f.left + f.width / 2; return x >= p.left && x <= p.right; })()`;
  await until(async () => {
    await shell.state(`s.activate(${js(tabId)}); s.setFind(${js(tabId)}, { open: true, focusRequest: Date.now() }); return true;`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    return shell.eval(focusedInPane);
  }, { timeout: 8000, label: `pane ${tabId}'s find field focus` });
  await shell.key("Escape", { code: "Escape", keyCode: 27 });
  return until(async () => {
    const f = await findState(shell, tabId);
    return f && !f.open && f.count === null ? f : false;
  }, { timeout: 5000, label: `find bar on ${tabId} to close` });
}

async function devtoolsTargets(app) {
  return (await app.browserTargets()).filter(DEVTOOLS);
}

async function attachedPages(app, ids) {
  const infos = await app.browserTargets();
  return Object.fromEntries(ids.map((id) => [id, infos.find((t) => t.targetId === id)?.attached ?? null]));
}

async function openDevTools(app, shell, tabId, command, expectedTarget, otherTarget) {
  await focusPane(shell, tabId);
  await shell.command(command);
  const frontends = await until(async () => {
    const list = await devtoolsTargets(app);
    return list.length ? list : false;
  }, { timeout: 15000, label: `${command} frontend` });
  const attached = await until(async () => {
    const state = await attachedPages(app, [expectedTarget.id, otherTarget.id]);
    return state[expectedTarget.id] ? state : false;
  }, { timeout: 8000, label: `${command} to inspect the active pane` });
  if (attached[otherTarget.id]) throw new Error(`${command} also attached to the other pane`);
  return { frontends: frontends.map((f) => ({ url: f.url, type: f.type })), attached };
}

async function closeDevTools(app, shell, tabId) {
  await focusPane(shell, tabId);
  await shell.command("toggleDevTools");
  await until(async () => (await devtoolsTargets(app)).length === 0, { timeout: 15000, label: "docked DevTools to close" });
}

export default {
  id: "F01",
  issue: 11,
  title: "Find, Print, Save Page and DevTools execute on the exact pane",
  deadline: 420000,
  async run(t) {
    const run = nonce("f01");
    const downloads = join(await t.scratch("downloads"), "");
    const { app, shell, scratch } = await startBrowser(t, {
      name: "native-ui",
      background: false,
      preferences: { downloads, printToPdf: true },
      extraArgs: ["--kiosk-printing", `--ardia-downloads-dir=${downloads}`],
    });
    let split;
    await t.check("two split panes load distinct find fixtures", async () => {
      split = await openSplit(shell, t.fixtures, run);
      return { tabA: split.tabA, tabB: split.tabB };
    }, { critical: true });

    await t.check("pane A finds 3 matches with next/previous", () => findOnPane(shell, split.tabA, 3));
    await t.check("pane B finds 5 matches with next/previous", () => findOnPane(shell, split.tabB, 5));
    await t.check("find results stay on their own pane", async () => {
      const [a, b] = await Promise.all([findState(shell, split.tabA), findState(shell, split.tabB)]);
      if (a?.count !== 3 || b?.count !== 5) throw new Error(`pane A ${a?.count}, pane B ${b?.count}`);
      return { a, b };
    });
    await t.check("Escape dismisses pane B's find bar only", async () => {
      const closed = await dismissFind(shell, split.tabB);
      const a = await findState(shell, split.tabA);
      if (!a?.open) throw new Error("dismissing pane B closed pane A's find bar");
      return { closed, a };
    });
    await t.check("Escape dismisses pane A's find bar", () => dismissFind(shell, split.tabA));

    await t.check("DevTools opens on pane B and toggles closed", async () => {
      const opened = await openDevTools(app, shell, split.tabB, "devTools", split.targetB, split.targetA);
      await closeDevTools(app, shell, split.tabB);
      return opened;
    });
    await t.check("Inspect Elements opens DevTools on pane A", async () => {
      const opened = await openDevTools(app, shell, split.tabA, "inspectElements", split.targetA, split.targetB);
      await closeDevTools(app, shell, split.tabA);
      return opened;
    });
    await t.check("JavaScript Console opens DevTools on pane B", async () => {
      const opened = await openDevTools(app, shell, split.tabB, "javaScriptConsole", split.targetB, split.targetA);
      const frontend = (await devtoolsTargets(app))[0];
      const session = frontend ? await app.connect(frontend).catch(() => null) : null;
      const location = session ? await evaluate(session, "location.href").catch(() => null) : null;
      await closeDevTools(app, shell, split.tabB);
      return { ...opened, frontendLocation: location };
    });

    await t.check("Print saves pane A as a PDF", async () => {
      const dirs = [downloads, join(scratch, "home", "Downloads")];
      const before = await filesIn(dirs, (name) => name.endsWith(".pdf"));
      await focusPane(shell, split.tabA);
      await shell.command("print");
      const pdfs = await until(async () => {
        const now = await filesIn(dirs, (name) => name.endsWith(".pdf") && !before.includes(name));
        return now.length ? now : false;
      }, { timeout: 45000, label: "a PDF from kiosk print to Save as PDF" });
      return { pdfs };
    });

    await t.check("Save Page command reaches the native host without failing the shell", async () => {
      await focusPane(shell, split.tabB);
      await shell.command("savePage");
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (app.exited) throw new Error("the browser exited after Save Page");
      await shell.eval("1");
      const crashed = shell.problems.filter((p) => /savePage|ERR_PAGE_(STALE|DISPATCH|ARGUMENT)/.test(p.text ?? ""));
      if (crashed.length) throw new Error(JSON.stringify(crashed));
      return { problems: shell.problems.length };
    });

    await t.screenshot(shell, "split-panes");
    await t.stop(app);

    await t.check("a background instance refuses DevTools but still finds", async () => {
      const background = await startBrowser(t, { name: "background", background: true });
      const urlA = t.fixtures.url.find(4, `bg-${run}`);
      const tabA = await background.shell.newTab(urlA);
      await background.shell.waitTabUrl(tabA, (url) => url === urlA);
      await background.app.pageLoaded(urlA);
      await background.shell.state(`s.setFind(${js(tabA)}, { open: true, query: ${js(FIND_WORD)}, focusRequest: Date.now() }); return true;`);
      const find = await until(async () => {
        const f = await findState(background.shell, tabA);
        return f?.count === 4 ? f : false;
      }, { timeout: 15000, label: "find in the background instance" });
      await background.shell.command("devTools");
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const frontends = await devtoolsTargets(background.app);
      await t.stop(background.app);
      if (frontends.length) throw new Error("a background instance opened DevTools");
      return { find };
    });
  },
};
