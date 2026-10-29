import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { evaluate } from "../lib/cdp.mjs";
import { ardiaWindow, clickBlankPage, clickInPage, clickMenuItem, clickRowToggle, clickSidebarTab, focusPageByClick, openSettingsRow, pageFixtures, pageSession, paneRect, probe, rowControl, screenPoint, scrolledIntoView, shot, titledSeed , closeSettingsWindow } from "../lib/desktopPages.mjs";
import { colorDistance, differingFraction, fractionNear, meanColor, parseHex, toHex, towards } from "../lib/desktopPixels.mjs";
import { clickLabelIn, clickTextIn, currentRect, desktopUnavailable, newWindow, openDesktop, pointAt, startDesktopBrowser } from "../lib/desktopSession.mjs";
import { ICON_COLOR } from "../lib/pageFixtures.mjs";
import { sessionSeed } from "../lib/seed.mjs";
import { js, nonce, until } from "../lib/util.mjs";

const peekOf = (shell) => shell.state("const peek = s.peeks[windowId]; return peek ? { tabId: peek.tabId, url: s.tabs[peek.tabId]?.url ?? null } : null;");
const splitWith = (shell, url) => shell.state(`const tab = Object.values(s.tabs).find((t) => t.url === ${js(url)}); if (!tab) return false; return Object.values(s.splits).some((split) => JSON.stringify(split).includes(tab.id)) ? tab.id : false;`);
const tabsOn = (shell, url) => shell.state(`return Object.values(s.tabs).filter((t) => t.url === ${js(url)}).map((t) => t.id);`);

async function modifierClick(desktop, point, modifiers) {
  for (const key of modifiers) await desktop.keyDown(key);
  await delay(120);
  await desktop.click(point.x, point.y);
  await delay(120);
  for (const key of [...modifiers].reverse()) await desktop.keyUp(key);
}

async function closePeek(desktop, shell) {
  await desktop.key("escape");
  await until(async () => !(await peekOf(shell)), { timeout: 4000, label: "Escape to close the peek" }).catch(async () => {
    await shell.eval("(() => { const s = ardiaLinux.store.getState(); const w = Object.keys(s.peeks)[0]; if (w) s.closePeek?.(w); return true; })()");
  });
}

async function choosePopUp(desktop, app, shell, title, option, { prefix = false } = {}) {
  const { settings, window } = await openSettingsRow(desktop, app, shell, "Tabs", title);
  const control = await scrolledIntoView(desktop, window, settings, () => rowControl(settings, title, { minWidth: 40, maxWidth: 420, nearest: true }), { label: `the ${title} menu` });
  try {
    await pointAt(desktop, window, control);
    await delay(600);
    await clickMenuItem(desktop, window, settings, option, { prefix });
    await delay(600);
  } finally {
    await desktop.key("escape").catch(() => {});
    await closeSettingsWindow(desktop, window, settings).catch(() => {});
  }
  await delay(800);
}

export function popoverVerdict(before, shown, bar) {
  const around = { x: bar.x, y: Math.max(0, bar.y - 28), width: bar.width, height: Math.min(24, Math.max(0, bar.y - 4)) };
  return { onScreen: differingFraction(before, shown, bar), around: around.height ? differingFraction(before, shown, around) : 0 };
}

export const f16Desktop = {
  id: "F16D",
  issue: 26,
  desktop: true,
  title: "Physical modifier clicks, changed link modifiers, the selection popover and dragging a link out, with real keys and the pointer in a private sway session",
  deadline: 420000,
  async run(t) {
    const missing = await desktopUnavailable();
    if (missing) {
      t.manual("Physical modifier clicks", ["Shift-click a link: a peek opens. Alt+Shift-click: a split pane. Change the modifiers in Settings › Tabs and repeat."], missing);
      t.manual("Selection popover and Escape", ["Drag-select a sentence: the popover appears beside it; Escape closes it."], missing);
      t.manual("Drag a link out of a page", ["Drag a link and drop it back over the page with no drop target: one foreground tab opens; outside the window or on a drop target nothing opens."], missing);
      return;
    }
    const run = nonce("f16d");
    const desktop = await openDesktop(t);
    const pages = await pageFixtures(t);
    const target = t.fixtures.url.page(6, run);
    const urlOne = pages.http("links", `?title=Links+one&to=${encodeURIComponent(target)}`);
    const urlTwo = pages.http("links", `?title=Links+two&to=${encodeURIComponent(`${target}-two`)}`);
    const { app, shell } = await startDesktopBrowser(t, desktop, { name: "gestures", session: titledSeed(sessionSeed({ windows: [{ id: "main", urls: [urlTwo, urlOne] }] }), { [urlOne]: "Links one", [urlTwo]: "Links two" }) });
    const window = await ardiaWindow(desktop);
    const tabOne = (await tabsOn(shell, urlOne))[0];
    const one = await pageSession(app, urlOne);
    await focusPageByClick(desktop, window, shell, app, urlOne, tabOne);
    const link = () => screenPoint(desktop, window, shell, one, tabOne, "document.getElementById('link')");

    await t.check("a physical Shift-click on a link opens it in a peek", async () => {
      await modifierClick(desktop, await link(), ["shift"]);
      const peek = await until(async () => { const p = await peekOf(shell); return p?.url === target ? p : false; }, { timeout: 8000, label: "the peek on the link" });
      await shot(t, desktop, "peek");
      await closePeek(desktop, shell);
      return peek;
    });

    await t.check("with Peek set to Alt-click in Settings › Tabs, a physical Alt-click peeks without reloading the page", async () => {
      await evaluate(one, "window.notReloaded = true", { userGesture: false });
      await choosePopUp(desktop, app, shell, "Peek a link with", "Alt-click");
      const setting = await until(async () => { const v = await shell.state("return s.settings.peekModifier"); return v === "alt" ? v : false; }, { timeout: 5000, label: "the peek modifier to become alt" });
      await focusPageByClick(desktop, window, shell, app, urlOne, tabOne);
      await modifierClick(desktop, await link(), ["alt"]);
      const peek = await until(async () => { const p = await peekOf(shell); return p?.url === target ? p : false; }, { timeout: 8000, label: "an Alt-click peek" });
      await closePeek(desktop, shell);
      if (!(await evaluate(one, "window.notReloaded === true", { userGesture: false }))) throw new Error("the page reloaded");
      return { setting, peek };
    });

    await t.check("with split view set to Alt-click, a physical Alt-click opens a split and Shift-click peeks again", async () => {
      await choosePopUp(desktop, app, shell, "Open a link in split view with", "Alt-click", { prefix: true });
      const settings = await until(async () => { const v = await shell.state("return { peek: s.settings.peekModifier ?? null, split: s.settings.splitLinkModifier ?? null }"); return v.split === "alt" ? v : false; }, { timeout: 5000, label: "the split modifier to become alt" });
      await focusPageByClick(desktop, window, shell, app, urlOne, tabOne);
      await modifierClick(desktop, await link(), ["shift"]);
      await until(async () => { const p = await peekOf(shell); return p?.url === target ? p : false; }, { timeout: 8000, label: "a Shift-click peek after the split change" });
      await closePeek(desktop, shell);
      await focusPageByClick(desktop, window, shell, app, urlOne, tabOne);
      await modifierClick(desktop, await link(), ["alt"]);
      const split = await until(() => splitWith(shell, target), { timeout: 8000, label: "an Alt-click split pane" });
      await shot(t, desktop, "split");
      return { settings, split };
    });

    await clickSidebarTab(desktop, window, shell, "Links two");
    const tabTwo = (await tabsOn(shell, urlTwo))[0];
    const two = await pageSession(app, urlTwo);
    await focusPageByClick(desktop, window, shell, app, urlTwo, tabTwo);

    await t.check("drag-selecting a sentence shows the selection popover beside it and Escape closes it, keeping the selection", async () => {
      const words = await screenPoint(desktop, window, shell, two, tabTwo, "document.getElementById('words')");
      const before = await desktop.capture();
      await desktop.drag({ x: words.rect.x + 2, y: words.y }, { x: words.rect.x + words.rect.width - 2, y: words.y }, { steps: 16, hold: 120 });
      const selected = await until(async () => { const s = await shell.eval(`ardiaLinux.selection.state.getState()[${js(tabTwo)}] ?? null`); return s?.text ? s : false; }, { timeout: 8000, label: "the selection" });
      await delay(1200);
      const shown = await desktop.capture();
      await shot(t, desktop, "selection-popover");
      const frame = await currentRect(desktop, window);
      const inShell = await shell.eval(`(() => { const n = document.querySelector('[data-testid="ardia-page-overlay"] > div > div'); if (!n) return null; const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, width: r.width, height: r.height } : null; })()`);
      if (!inShell) throw new Error(`the shell shows no selection popover for ${JSON.stringify(selected.text)}`);
      const near = { x: Math.round(frame.x + inShell.x), y: Math.round(frame.y + inShell.y), width: Math.round(inShell.width), height: Math.round(inShell.height) };
      const drawn = popoverVerdict(before, shown, near);
      if (drawn.onScreen < 0.1) throw new Error(`the shell has the selection popover at ${JSON.stringify(near)} but only ${(drawn.onScreen * 100).toFixed(1)}% of its pixels changed on screen`);
      if (drawn.around > 0.25) throw new Error(`the page above the popover at ${JSON.stringify(near)} isn't drawn (${(drawn.around * 100).toFixed(1)}% changed)`);
      await desktop.key("escape");
      await until(async () => !(await shell.eval(`!!document.querySelector('[data-testid="ardia-page-overlay"] > div > div')`)), { timeout: 3000, label: "Escape to close the selection popover" });
      await delay(500);
      const after = await desktop.capture();
      const gone = differingFraction(shown, after, near);
      if (gone < 0.1) throw new Error(`the popover at ${JSON.stringify(near)} stayed on screen after Escape (changed ${gone.toFixed(2)})`);
      const kept = await evaluate(two, "getSelection().toString()", { userGesture: false });
      if (!kept.includes("quoted sentence")) throw new Error(`Escape dropped the page's selection (${JSON.stringify(kept)})`);
      return { selection: selected.text, popover: near, drawn, gone, selectionRect: words.rect };
    });

    const url = `${target}-two`;
    const windowTabs = (windowShell) => windowShell.state(`const w = s.windows[windowId]; return { profileId: w?.profileId ?? null, active: w ? (w.activeTabIds?.[w.profileId] ?? null) : null, tabs: (w?.tabIds ?? []).map((id) => ({ id, url: s.tabs[id]?.url ?? null, profileId: s.tabs[id]?.profileId ?? null })) };`);
    const onLink = (state) => state.tabs.filter((tab) => tab.url === url);
    const logged = () => evaluate(two, "(window.dragLog ?? []).slice()", { userGesture: false });
    const dragRan = async (before, label) => {
      const now = (await logged()).slice(before.length);
      if (!now.includes("dragstart") || !now.includes("dragend")) throw new Error(`${label}: no drag ran (page events ${JSON.stringify(now)})`);
      return now;
    };
    const focusLinks = async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        if ((await shell.activeTabId()) !== tabTwo) await clickSidebarTab(desktop, window, shell, "Links two");
        await desktop.raise(window).catch(() => {});
        await delay(300);
        const ok = await focusPageByClick(desktop, window, shell, app, urlTwo, tabTwo).then(() => true, (error) => error);
        if (ok === true) return;
        if (attempt === 1) {
          await shot(t, desktop, "links-page-focus");
          throw new Error(`${ok.message}; compositor focus ${JSON.stringify((await desktop.focused())?.title ?? null)}`);
        }
      }
    };

    await t.check("dragging a link onto its own page with no drop target opens one foreground tab on the link", async () => {
      await focusLinks();
      await evaluate(two, "window.dragLog = []; for (const e of ['dragstart', 'dragend', 'drop']) document.addEventListener(e, () => dragLog.push(e), true); true", { userGesture: false });
      const before = await logged();
      const from = await screenPoint(desktop, window, shell, two, tabTwo, "document.getElementById('link')");
      const pane = await paneRect(shell, tabTwo);
      const frame = await currentRect(desktop, window);
      await desktop.drag({ x: from.x, y: from.y }, { x: frame.x + pane.left + pane.width * 0.7, y: frame.y + pane.top + pane.height * 0.75 }, { steps: 20, hold: 250 });
      const events = await dragRan(before, "own page");
      const opened = await until(async () => { const tabs = onLink(await windowTabs(shell)); return tabs.length ? tabs : false; }, { timeout: 6000, label: "a tab on the dragged link" }).catch((error) => { throw new Error(`${error.message}; page events ${JSON.stringify(events)}`); });
      await delay(1500);
      const state = await windowTabs(shell);
      if (onLink(state).length !== 1) throw new Error(`${onLink(state).length} tabs opened`);
      if (state.active !== opened[0].id) throw new Error("the new tab isn't in front");
      return { opened: opened[0], events };
    });

    await t.check("dragging a link onto a drop target in its page opens nothing and the target gets the drop", async () => {
      await focusLinks();
      const before = await windowTabs(shell);
      const beforeLog = await logged();
      const from = await screenPoint(desktop, window, shell, two, tabTwo, "document.getElementById('link')");
      const drop = await screenPoint(desktop, window, shell, two, tabTwo, "document.getElementById('target')");
      await desktop.drag({ x: from.x, y: from.y }, { x: drop.x, y: drop.y }, { steps: 20, hold: 250 });
      await until(() => evaluate(two, "drops === 1", { userGesture: false }), { timeout: 5000, label: "the page's drop target to receive the drop" });
      const events = await dragRan(beforeLog, "drop target");
      await delay(2500);
      const after = await windowTabs(shell);
      if (after.tabs.length !== before.tabs.length) throw new Error(`${after.tabs.length - before.tabs.length} tabs opened`);
      return { drops: await evaluate(two, "drops", { userGesture: false }), events };
    });

    await t.check("dragging a link out of the window onto the empty desktop opens nothing", async () => {
      await focusLinks();
      const before = await windowTabs(shell);
      await desktop.command(`[con_id=${window.id}] floating enable, resize set 1280 860, move position 0 0`);
      try {
        await delay(1000);
        const beforeLog = await logged();
        const from = await screenPoint(desktop, window, shell, two, tabTwo, "document.getElementById('link')");
        await desktop.drag({ x: from.x, y: from.y }, { x: 1700, y: 1000 }, { steps: 24, hold: 250 });
        await delay(2500);
        const events = await dragRan(beforeLog, "outside the window");
        await shot(t, desktop, "drop-outside-window");
        const after = await windowTabs(shell);
        const added = after.tabs.filter((tab) => !before.tabs.some((old) => old.id === tab.id));
        if (added.length) throw new Error(`${added.length} tab(s) opened: ${JSON.stringify(added)} (page events ${JSON.stringify(events)})`);
        return { events };
      } finally {
        await desktop.command(`[con_id=${window.id}] floating disable`).catch(() => {});
        await delay(1000);
      }
    });

    await t.check("dragging a link onto a second Ardia window opens one foreground tab there in its profile and leaves the first window unchanged", async () => {
      await focusLinks();
      const known = await desktop.windows();
      await desktop.key("ctrl+n");
      const second = await newWindow(desktop, known, { label: "the second Ardia window" });
      const secondShell = await until(async () => {
        const found = (await app.shells()).find((s) => s.ready && !s.utility && s.windowId !== shell.windowId);
        return found ? app.shell(found.windowId) : false;
      }, { timeout: 15000, label: "the second window's shell" });
      const otherUrl = t.fixtures.url.page(3, run);
      const otherTab = await secondShell.newTab(otherUrl);
      await secondShell.waitTabUrl(otherTab, (u) => u === otherUrl);
      await delay(1500);
      const first = await currentRect(desktop, window);
      const other = await currentRect(desktop, second);
      if (first.x === other.x) throw new Error(`the two windows overlap: ${JSON.stringify({ first, other })}`);
      const before = { first: await windowTabs(shell), second: await windowTabs(secondShell) };
      let events = [];
      let start = null;
      let drop = null;
      const attempts = [];
      for (let attempt = 0; attempt < 3 && !events.includes("dragstart"); attempt++) {
        if ((await probe(app, urlTwo, "location.href").catch(() => null)) !== urlTwo) {
          await shell.navigate(tabTwo, urlTwo);
          await shell.waitTabUrl(tabTwo, (u) => u === urlTwo);
          await until(() => probe(app, urlTwo, "document.readyState === 'complete'"), { timeout: 10000, label: "the links page to load again" });
        }
        await focusLinks();
        await evaluate(two, "window.dragLog = window.dragLog ?? []; if (!window.pressLogged) { window.pressLogged = true; for (const e of ['mousedown', 'mouseup']) document.addEventListener(e, () => dragLog.push(e), true); } true", { userGesture: false });
        const from = await screenPoint(desktop, window, shell, two, tabTwo, "document.getElementById('link')");
        start = { x: from.rect.x + 24, y: from.y };
        drop = { x: start.x - first.x + other.x, y: start.y - first.y + other.y };
        await desktop.pointerMove(start.x, start.y + 120);
        await delay(200);
        await desktop.pointerMove(start.x, start.y);
        await until(() => evaluate(two, "document.getElementById('link').matches(':hover')", { userGesture: false }), { timeout: 3000, label: "the link under the pointer" }).catch(() => {});
        const beforeLog = await logged();
        await desktop.drag(start, drop, { steps: 24, hold: 250 });
        await delay(800);
        events = (await logged().catch(() => [])).slice(beforeLog.length);
        attempts.push({ events, href: await probe(app, urlTwo, "location.href").catch(() => "(gone)") });
      }
      if (!events.includes("dragstart") || !events.includes("dragend")) {
        await shot(t, desktop, "second-window-no-drag");
        throw new Error(`second window: no drag ran in 3 attempts (${JSON.stringify(attempts)})`);
      }
      await delay(3000);
      await shot(t, desktop, "drop-on-second-window");
      const after = { first: await windowTabs(shell), second: await windowTabs(secondShell) };
      const added = (name) => after[name].tabs.filter((tab) => !before[name].tabs.some((old) => old.id === tab.id));
      const firstAdded = added("first");
      const secondAdded = added("second");
      const detail = { first: firstAdded, second: secondAdded, secondProfile: after.second.profileId, secondActive: after.second.active, events, attempts: attempts.length };
      if (firstAdded.length || JSON.stringify(after.first.tabs.map((x) => x.id)) !== JSON.stringify(before.first.tabs.map((x) => x.id))) throw new Error(`the first window changed: ${JSON.stringify(detail)}`);
      if (secondAdded.length !== 1) throw new Error(`${secondAdded.length} tabs opened in the second window: ${JSON.stringify(detail)}`);
      const [tab] = secondAdded;
      if (tab.url !== url) throw new Error(`the second window's new tab is on ${tab.url}, not the link: ${JSON.stringify(detail)}`);
      if (tab.profileId !== after.second.profileId) throw new Error(`the new tab is in profile ${tab.profileId}, not the window's ${after.second.profileId}`);
      if (after.second.active !== tab.id) throw new Error(`the new tab isn't in front in the second window: ${JSON.stringify(detail)}`);
      return detail;
    });
    await t.stop(app);
  },
};

const TINT_KINDS = [{ kind: "meta", color: "#336699" }, { kind: "background", color: "#22aa66" }, { kind: "header", color: "#aa2244" }];

async function chromeSamples(desktop, window, shell, tabId) {
  const frame = await currentRect(desktop, window);
  const pane = await paneRect(shell, tabId);
  const image = await desktop.capture();
  const sidebar = { x: frame.x + 12, y: frame.y + 420, width: Math.max(20, pane.left - 30), height: 400 };
  const toolbar = { x: frame.x + pane.left + 600, y: frame.y + 4, width: Math.max(40, pane.width - 900), height: Math.max(8, pane.top - 12) };
  return { sidebar: meanColor(image, sidebar), toolbar: meanColor(image, toolbar), image, pane, frame, rects: { sidebar, toolbar } };
}

export const f25Desktop = {
  id: "F25D",
  issue: 35,
  desktop: true,
  title: "The toolbar hides while scrolling and the website tint, measured in pixels in a private sway session",
  deadline: 360000,
  async run(t) {
    const missing = await desktopUnavailable();
    if (missing) {
      t.manual("Toolbar hides and returns on screen", ["With Hide toolbar while scrolling on, scroll down: the toolbar slides away; up: it returns. Off: it stays."], missing);
      t.manual("Tint looks right", ["A page with a theme color tints the sidebar and toolbar; a plain page resets; Extend website color off keeps Ardia's colors."], missing);
      return;
    }
    const desktop = await openDesktop(t);
    const pages = await pageFixtures(t);
    const plain = t.fixtures.url.tint("plain");
    const long = pages.http("links", "?title=Long+page&bg=22aa66&to=about%3Ablank");
    const { app, shell } = await startDesktopBrowser(t, desktop, { name: "tint", session: titledSeed(sessionSeed({ windows: [{ id: "main", urls: [long, plain] }], settings: { hideToolbarWhileScrolling: true, extendWebsiteColor: true } }), { [long]: "Long page", [plain]: "Tint plain" }) });
    const window = await ardiaWindow(desktop);
    const tabId = await shell.activeTabId();
    await focusPageByClick(desktop, window, shell, app, plain, tabId);
    await delay(1000);
    const base = await chromeSamples(desktop, window, shell, tabId);
    await shot(t, desktop, "tint-plain");

    for (const { kind, color } of TINT_KINDS) {
      await t.check(`a ${kind} page tints the toolbar towards ${color} on screen`, async () => {
        const url = t.fixtures.url.tint(kind);
        await shell.navigate(tabId, url);
        await shell.waitTabUrl(tabId, (u) => u === url);
        const want = parseHex(color);
        let now = null;
        await until(async () => { now = await chromeSamples(desktop, window, shell, tabId); return towards(base.toolbar, want, now.toolbar) >= 0.5; }, { timeout: 6000, interval: 400, label: `the toolbar to take ${color}` }).catch(() => {});
        await shot(t, desktop, `tint-${kind}`);
        const result = { base: { sidebar: toHex(base.sidebar), toolbar: toHex(base.toolbar) }, now: { sidebar: toHex(now.sidebar), toolbar: toHex(now.toolbar) }, towards: { sidebar: +towards(base.sidebar, want, now.sidebar).toFixed(3), toolbar: +towards(base.toolbar, want, now.toolbar).toFixed(3) } };
        if (result.towards.toolbar < 0.5) throw new Error(`the toolbar didn't take ${color}: ${JSON.stringify(result)}`);
        return result;
      });
    }

    await t.check("a plain page resets the tint", async () => {
      await shell.navigate(tabId, `${plain}?again=1`);
      await shell.waitTabUrl(tabId, (u) => u.startsWith(plain));
      await delay(1800);
      const now = await chromeSamples(desktop, window, shell, tabId);
      const drift = { sidebar: colorDistance(base.sidebar, now.sidebar), toolbar: colorDistance(base.toolbar, now.toolbar) };
      if (drift.toolbar > 6) throw new Error(`the toolbar kept a tint: ${JSON.stringify({ base: [toHex(base.sidebar), toHex(base.toolbar)], now: [toHex(now.sidebar), toHex(now.toolbar)] })}`);
      return drift;
    });

    await t.check("with Extend website color into tab bar turned off in Settings, a themed page keeps Ardia's colors", async () => {
      const { window: settingsWindow, settings } = await openSettingsRow(desktop, app, shell, "Tabs", "Extend website color into tab bar");
      await clickRowToggle(desktop, settingsWindow, settings, "Extend website color into tab bar");
      await delay(600);
      await closeSettingsWindow(desktop, settingsWindow, settings);
      await until(async () => (await shell.state("return s.settings.extendWebsiteColor")) === false, { timeout: 5000, label: "the setting to turn off" });
      const url = t.fixtures.url.tint("meta");
      await shell.navigate(tabId, `${url}?off=1`);
      await shell.waitTabUrl(tabId, (u) => u.startsWith(url));
      await delay(1800);
      const now = await chromeSamples(desktop, window, shell, tabId);
      await shot(t, desktop, "tint-off");
      const drift = { sidebar: colorDistance(base.sidebar, now.sidebar), toolbar: colorDistance(base.toolbar, now.toolbar), towardPage: +towards(base.toolbar, parseHex("#336699"), now.toolbar).toFixed(3) };
      if (drift.towardPage > 0.08) throw new Error(`the toolbar took the page color with the setting off: ${JSON.stringify({ base: [toHex(base.sidebar), toHex(base.toolbar)], now: [toHex(now.sidebar), toHex(now.toolbar)] })}`);
      return drift;
    });

    await clickSidebarTab(desktop, window, shell, "Long page");
    const longTab = await shell.activeTabId();
    const scrollBand = async () => {
      const frame = await currentRect(desktop, window);
      const pane = await paneRect(shell, longTab);
      return { x: frame.x + pane.left + 300, y: frame.y + 30, width: pane.width - 600, height: 12 };
    };
    const green = (image, band) => fractionNear(image, band, parseHex("#22aa66"), 30);
    const wheel = async (dy, times) => {
      const pane = await paneRect(shell, longTab);
      const frame = await currentRect(desktop, window);
      await desktop.pointerMove(frame.x + pane.left + pane.width * 0.5, frame.y + pane.top + pane.height * 0.6);
      for (let i = 0; i < times; i++) { await desktop.scroll(dy); await delay(60); }
      await delay(1200);
    };

    await t.check("with Hide toolbar while scrolling on, wheel-scrolling down tucks the toolbar away on screen and scrolling up brings it back", async () => {
      await focusPageByClick(desktop, window, shell, app, long, longTab);
      const band = await scrollBand();
      const top = await desktop.capture();
      const paneTop = (await paneRect(shell, longTab)).top;
      await wheel(15, 8);
      const down = await desktop.capture();
      await shot(t, desktop, "toolbar-hidden");
      const before = green(top, band);
      const hidden = green(down, band);
      const scrolled = await probe(app, long, "scrollY");
      if (scrolled < 100) throw new Error(`the page didn't scroll (${scrolled})`);
      if (before > 0.05 || hidden < 0.9) throw new Error(`the band under the toolbar went from ${before.toFixed(2)} to ${hidden.toFixed(2)} page green; the toolbar didn't tuck away`);
      await wheel(-15, 4);
      const up = await desktop.capture();
      const back = green(up, band);
      if (back > 0.05) throw new Error(`the toolbar didn't come back (${back.toFixed(2)} of its band is page green)`);
      return { before, hidden, back, paneTop, paneTopHidden: (await paneRect(shell, longTab)).top };
    });

    await t.check("with Hide toolbar while scrolling off, the toolbar stays while scrolling", async () => {
      const { window: settingsWindow, settings } = await openSettingsRow(desktop, app, shell, "Tabs", "Hide toolbar while scrolling");
      await clickRowToggle(desktop, settingsWindow, settings, "Hide toolbar while scrolling");
      await delay(600);
      await closeSettingsWindow(desktop, settingsWindow, settings);
      await until(async () => (await shell.state("return s.settings.hideToolbarWhileScrolling")) === false, { timeout: 5000, label: "the setting to turn off" });
      await focusPageByClick(desktop, window, shell, app, long, longTab);
      await wheel(-15, 10);
      const band = await scrollBand();
      const top = await desktop.capture();
      const scrollBefore = await probe(app, long, "scrollY");
      await wheel(15, 8);
      const down = await desktop.capture();
      const scrollAfter = await probe(app, long, "scrollY");
      if (scrollAfter < scrollBefore + 100) throw new Error(`the page didn't scroll (${scrollBefore} → ${scrollAfter})`);
      const changed = green(down, band);
      if (green(top, band) > 0.05 || changed > 0.05) throw new Error(`the toolbar left its band (${changed.toFixed(2)} page green) with the setting off`);
      return { changed, scrolled: [scrollBefore, scrollAfter] };
    });
    await t.stop(app);
  },
};

export const f24Desktop = {
  id: "F24D",
  issue: 34,
  desktop: true,
  title: "A fetched favicon shows in a pinned tile and in the top tab strip, measured in pixels in a private sway session",
  deadline: 300000,
  async run(t) {
    const missing = await desktopUnavailable();
    if (missing) {
      t.manual("Icons in essentials and the top strip", ["Pin the fixture page and switch to the top tab strip: the fetched icon shows in the tile and the strip, not the globe."], missing);
      return;
    }
    const desktop = await openDesktop(t);
    const pages = await pageFixtures(t);
    const url = pages.http("icon");
    const { app, shell } = await startDesktopBrowser(t, desktop, { name: "icons", session: titledSeed(sessionSeed({ windows: [{ id: "main", urls: [url] }] }), { [url]: "Magenta icon" }), extraArgs: [`--ip-address-space-overrides=127.0.0.1:${t.fixtures.ports.http}=public`] });
    const window = await ardiaWindow(desktop);
    const tabId = await shell.activeTabId();
    await until(async () => (await shell.tab(tabId))?.favicon, { timeout: 15000, label: "the tab's favicon" });
    const magenta = (image, rect) => fractionNear(image, rect, ICON_COLOR, 40);
    await t.check("pinning the page from its hover card shows the magenta icon in the pinned tile", async () => {
      const frame = await currentRect(desktop, window);
      const row = await until(() => shell.rectByText("Magenta icon"), { timeout: 8000, label: "the sidebar row" });
      await desktop.pointerMove(frame.x + row.x, frame.y + row.y);
      await delay(900);
      await clickLabelIn(desktop, window, shell, "Pin");
      await until(async () => (await shell.tab(tabId))?.pin, { timeout: 5000, label: "the tab to be pinned" });
      await desktop.pointerMove(frame.x + frame.width * 0.6, frame.y + frame.height * 0.6);
      await delay(1200);
      const pane = await paneRect(shell, tabId);
      const image = await desktop.capture();
      await shot(t, desktop, "pinned-tile");
      const sidebar = { x: frame.x, y: frame.y + 40, width: pane.left, height: 240 };
      const share = magenta(image, sidebar);
      const pixels = Math.round(share * sidebar.width * sidebar.height);
      if (pixels < 64) throw new Error(`only ${pixels} magenta pixels in the sidebar's top`);
      return { pixels };
    });
    await t.check("after switching to the top tab strip with Ctrl+Shift+S, the strip shows the magenta icon", async () => {
      await focusPageByClick(desktop, window, shell, app, url, tabId);
      await desktop.key("ctrl+shift+s");
      await until(async () => (await paneRect(shell, tabId))?.left < 40, { timeout: 5000, label: "the top tab strip" });
      await delay(1500);
      const frame = await currentRect(desktop, window);
      const pane = await paneRect(shell, tabId);
      const image = await desktop.capture();
      await shot(t, desktop, "top-strip");
      const strip = { x: frame.x, y: frame.y, width: frame.width, height: Math.max(30, pane.top) };
      const pixels = Math.round(magenta(image, strip) * strip.width * strip.height);
      if (pane.left > 40) throw new Error(`the sidebar is still there (pane starts at x ${pane.left})`);
      if (pixels < 64) throw new Error(`only ${pixels} magenta pixels above the page`);
      return { pixels, paneTop: pane.top };
    });
    await t.stop(app);
  },
};

export const w75Desktop = {
  id: "W75D",
  issue: 75,
  desktop: true,
  title: "A finishing download's row never shows Deleted, checked on every rendered frame in a private sway session",
  deadline: 240000,
  async run(t) {
    const missing = await desktopUnavailable();
    if (missing) {
      t.manual("A finished download never flashes as missing", ["Download a file and watch its row as it finishes: it never shows Deleted first."], missing);
      return;
    }
    const desktop = await openDesktop(t);
    const pages = await pageFixtures(t);
    const folder = join(await t.scratch("downloads"), "Downloads");
    await mkdir(folder, { recursive: true });
    const name = `frames-${nonce("w75")}.bin`;
    const size = 6 << 20;
    const url = t.fixtures.url.page(2, "w75d");
    const { app, shell } = await startDesktopBrowser(t, desktop, { name: "frames", session: sessionSeed({ windows: [{ id: "main", urls: [url] }] }), preferences: { downloads: folder } });
    const window = await ardiaWindow(desktop);
    const tabId = await shell.activeTabId();
    await t.check("from the first frame a download's row is drawn until two seconds after it finishes, no rendered frame shows it as Deleted", async () => {
      await shell.eval(`(() => { const name = ${js(name)}; window.__rowFrames = []; const tick = () => { const text = document.body.innerText; const at = text.indexOf(name); window.__rowFrames.push(at < 0 ? null : text.slice(at, at + 160)); if (!window.__rowStop) requestAnimationFrame(tick); }; window.__rowStop = false; requestAnimationFrame(tick); return true; })()`);
      await focusPageByClick(desktop, window, shell, app, url, tabId);
      await desktop.key("ctrl+j");
      await delay(800);
      await shell.navigate(tabId, t.fixtures.url.download(name, size));
      await until(() => stat(join(folder, name)).then((s) => s.size === size, () => false), { timeout: 30000, label: `${name} complete on disk` });
      for (let i = 0; i < 6; i++) { await shot(t, desktop, `row-finished-${i}`); await delay(300); }
      const frames = await shell.eval("(window.__rowStop = true, window.__rowFrames)");
      const seen = frames.filter(Boolean);
      const flashes = seen.filter((text) => /Deleted/.test(text));
      if (!seen.length) throw new Error(`the row never rendered (${frames.length} frames)`);
      if (flashes.length) throw new Error(`${flashes.length} of ${seen.length} frames showed Deleted: ${JSON.stringify(flashes[0])}`);
      return { frames: frames.length, rowFrames: seen.length, first: seen[0], last: seen.at(-1) };
    });
    await t.stop(app);
  },
};
