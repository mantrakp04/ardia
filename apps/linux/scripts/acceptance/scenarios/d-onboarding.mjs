import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { clickLabelIn, clickTextIn, desktopShot, desktopUnavailable, focusShellWindow, newWindow, openDesktop, openSettingsWindow, pointAt, startDesktopBrowser, visibleField } from "../lib/desktopSession.mjs";
import { buttonNear, paneLines, scrollToText } from "../lib/desktopSettings.mjs";
import { documentDirectory } from "../lib/seed.mjs";
import { until } from "../lib/util.mjs";

const SHORTCUT = "ctrl+alt+o";
const SHORTCUT_LABEL = "Ctrl+Alt+O";
const PINS = ["https://github.com/", "https://linear.app/"];
const CHOICES = {
  "Where are you coming from?": ["Starting fresh"],
  "Where do your tabs go?": ["Along the top"],
  "Where does Ctrl+L open?": ["Under the address"],
  "Search with what?": ["DuckDuckGo"],
};
const REPLAY_MARKS = ["Your new home on the internet", "Where are you coming from?"];

const stepOf = (lines) => {
  const at = lines.findIndex((l) => /^STEP \d+ OF \d+$/.test(l));
  return at >= 0 ? { step: lines[at], title: lines[at + 1] } : null;
};
const onboardingShown = async (shell) => {
  const text = await shell.text();
  return REPLAY_MARKS.some((mark) => text.includes(mark));
};
const browserWindow = async (desktop) => until(async () => (await desktop.windows()).find((w) => / - Ardia$/.test(w.title)) ?? false, { timeout: 10000, label: "the browser window" });
const choices = (shell) => shell.state("return { layout: s.settings.tabLayout, engine: s.settings.searchEngine, pins: Object.values(s.tabs).filter((t) => t.pin && t.windowId === windowId).map((t) => t.pinnedUrl ?? t.url).sort() };");

async function clickInto(desktop, window, shell, { escape = true } = {}) {
  await desktop.raise(window);
  await until(async () => (await desktop.focused())?.id === window.id, { timeout: 5000, label: `${window.title} focused` });
  const field = await until(() => visibleField(shell), { timeout: 5000, label: `a field to click in ${window.title}` });
  await pointAt(desktop, window, field);
  await until(() => shell.eval("document.hasFocus()"), { timeout: 5000, label: `${window.title} to take keyboard focus` });
  if (escape) await desktop.key("escape");
  await delay(300);
}

async function continueState(shell) {
  return shell.eval(`(() => {
    const label = [...document.querySelectorAll('*')].filter((n) => (n.innerText ?? '').trim() === 'Continue' && n.getBoundingClientRect().width > 0).sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height)[0];
    if (!label) return null;
    const control = label.closest('[role=button], button, [tabindex]') ?? label;
    const aria = control.getAttribute('aria-disabled');
    const native = control.disabled === true;
    const pointer = getComputedStyle(control).pointerEvents;
    const disabled = aria === 'true' || native;
    return { disabled, reason: [aria === 'true' ? 'aria-disabled=true' : null, native ? 'disabled' : null, pointer === 'none' ? 'pointer-events:none' : null].filter(Boolean).join(', ') || null };
  })()`);
}

async function advance(desktop, shell, label, from, { timeout = 4000 } = {}) {
  const window = await browserWindow(desktop);
  await clickTextIn(desktop, window, shell, label);
  return until(async () => {
    const now = stepOf((await shell.text()).split("\n"));
    return !now || now.title !== from.title || now.step !== from.step ? now ?? { done: true } : false;
  }, { timeout, label: `onboarding to move on from ${from.title} after ${label}` }).catch(() => null);
}

async function walkOnboarding(t, desktop, shell) {
  const walked = [];
  const stuck = [];
  for (let guard = 0; guard < 30; guard++) {
    const lines = (await shell.text()).split("\n").map((l) => l.trim());
    if (lines.includes("Get Started")) {
      await clickTextIn(desktop, await browserWindow(desktop), shell, "Get Started");
      walked.push("Get Started");
      return { walked, stuck };
    }
    const here = stepOf(lines);
    if (!here) throw new Error(`no onboarding step on screen: ${JSON.stringify(lines.slice(0, 12))}`);
    const window = await browserWindow(desktop);
    for (const choice of CHOICES[here.title] ?? []) {
      await clickTextIn(desktop, window, shell, choice);
      await delay(400);
    }
    let next;
    if (here.title === "Keep your favorite apps handy") {
      await clickTextIn(desktop, window, shell, "GitHub");
      await delay(300);
      await clickTextIn(desktop, window, shell, "Linear");
      await delay(300);
      next = await advance(desktop, shell, "Pin 2 Tabs", here);
    } else next = (await advance(desktop, shell, "Continue", here, { timeout: 10000 })) ?? (await advance(desktop, shell, "Continue", here, { timeout: 10000 }));
    if (!next) {
      stuck.push({ step: here.title, continue: await continueState(shell) });
      await desktopShot(t, desktop, `onboarding-stuck-${stuck.length}`);
      next = await advance(desktop, shell, "Skip", here);
      if (!next) throw new Error(`neither Continue nor Skip leaves ${here.title}`);
    }
    walked.push(here.title);
    await delay(300);
  }
  throw new Error(`onboarding never reached its last step: ${walked.join(" › ")}`);
}

export default {
  id: "F27D",
  issue: 37,
  desktop: true,
  title: "Onboarding clicked through in a desktop session: every step, setup choices in a second window and after restart, Show Onboarding from the browser and from Settings",
  deadline: 420000,
  async run(t) {
    const missing = await desktopUnavailable();
    if (missing) {
      t.manual("Finishing onboarding through its steps", ["Click through every onboarding step on a fresh profile; restart; Show Onboarding replays it."], missing);
      t.manual("Setup choices apply across windows", ["Choose DuckDuckGo, tabs along the top and two pins; a second window and a restart keep them."], missing);
      t.manual("Onboarding and tours from a utility window", ["Run Show Onboarding from Settings: it plays in a browser window."], missing);
      return;
    }
    const desktop = await openDesktop(t);
    let { app, shell, scratch } = await startDesktopBrowser(t, desktop, { name: "onboarding", seed: false, onboardingComplete: false });
    await shell.waitFor("document.body.innerText.includes('STEP 1 OF')", { timeout: 20000, label: "the first onboarding step" });
    let walk;
    await t.check("every onboarding step finishes with Continue, through to Get Started", async () => {
      walk = await walkOnboarding(t, desktop, shell);
      await desktopShot(t, desktop, "onboarding-finished");
      const saved = JSON.parse(await readFile(join(documentDirectory(scratch), "onboarding.json"), "utf8"));
      if (!saved.completedAt) throw new Error(`onboarding.json ${JSON.stringify(saved)}`);
      if (walk.stuck.length) throw new Error(`Continue didn't move on from ${walk.stuck.map((x) => `${x.step} (${x.continue?.disabled ? `disabled: ${x.continue.reason}` : "enabled"})`).join(", ")}; left with Skip; steps ${walk.walked.length}`);
      return { steps: walk.walked.length };
    }, { timeout: 180000 });
    await t.check("the choices apply in this window: tabs along the top, DuckDuckGo, GitHub and Linear pinned", async () => {
      const state = await until(async () => { const s = await choices(shell); return s.pins.length >= 2 ? s : false; }, { timeout: 10000, label: "the two pins" });
      if (state.layout !== "top" || state.engine !== "duckduckgo" || state.pins.join() !== PINS.join()) throw new Error(JSON.stringify(state));
      return state;
    });
    await t.check("a second window (Ctrl+N) shows the top tab layout and the same two pins", async () => {
      const known = await desktop.windows();
      await focusShellWindow(desktop, shell, await browserWindow(desktop));
      await desktop.key("ctrl+n");
      await newWindow(desktop, known, { label: "the second window" });
      const second = await until(async () => {
        const shells = (await app.shells()).filter((s) => !s.utility && s.windowId !== shell.windowId);
        return shells[0] ? app.shell(shells[0].windowId) : false;
      }, { timeout: 15000, label: "the second window's renderer" });
      const state = await until(async () => { const s = await choices(second); return s.pins.length ? s : false; }, { timeout: 10000, label: "pins in the second window" }).catch(async () => choices(second));
      await desktopShot(t, desktop, "second-window");
      if (state.layout !== "top" || state.pins.join() !== PINS.join()) throw new Error(JSON.stringify(state));
      const secondWindow = (await desktop.windows()).find((w) => !known.some((k) => k.id === w.id));
      await clickLabelIn(desktop, secondWindow, second, "Close window");
      await until(async () => (await desktop.windows()).length === known.length, { timeout: 8000, label: "the second window to close" });
      return state;
    });
    await t.check("Settings › Search Engine shows DuckDuckGo", async () => {
      const { settings, window } = await openSettingsWindow(desktop, app, shell, { pane: "Search Engine" });
      const lines = await until(async () => { const l = await paneLines(settings); return l.includes("DuckDuckGo") ? l : false; }, { timeout: 10000, label: "DuckDuckGo in Settings › Search Engine" });
      await desktopShot(t, desktop, "settings-search");
      await desktop.key("ctrl+w");
      return lines.filter((l) => /DuckDuckGo|Google/.test(l)).slice(0, 4);
    });
    await t.stop(app);
    ({ app, shell } = await startDesktopBrowser(t, desktop, { scratch, label: "restart" }));
    await t.check("after a restart onboarding doesn't return and the two pins aren't duplicated", async () => {
      await delay(3000);
      if (await onboardingShown(shell)) throw new Error("onboarding came back after a restart");
      const state = await choices(shell);
      if (state.pins.join() !== PINS.join()) throw new Error(JSON.stringify(state));
      return state;
    });
    let settingsUi;
    await t.check("Show Onboarding, given a shortcut in Settings › Keyboard Shortcuts, replays onboarding in the browser window", async () => {
      settingsUi = await openSettingsWindow(desktop, app, shell, { pane: "Keyboard Shortcuts" });
      await scrollToText(desktop, settingsUi.window, settingsUi.settings, "Show Onboarding");
      await pointAt(desktop, settingsUi.window, await until(() => buttonNear(settingsUi.settings, "Show Onboarding", "None"), { timeout: 8000, label: "Show Onboarding's shortcut button" }));
      await delay(500);
      await desktop.key(SHORTCUT);
      await until(async () => { const l = await paneLines(settingsUi.settings); return l[l.indexOf("Show Onboarding") + 1] === SHORTCUT_LABEL; }, { timeout: 5000, label: `${SHORTCUT_LABEL} recorded for Show Onboarding` });
      await clickInto(desktop, await browserWindow(desktop), shell);
      await desktop.key(SHORTCUT);
      await until(() => onboardingShown(shell), { timeout: 8000, label: "onboarding in the browser window" });
      await desktopShot(t, desktop, "replay-browser");
      await desktop.key("escape");
      return { shortcut: SHORTCUT_LABEL };
    });
    await t.check("Show Onboarding pressed in the Settings window plays in a browser window", async () => {
      await t.stop(app);
      ({ app, shell } = await startDesktopBrowser(t, desktop, { scratch, label: "settings-replay" }));
      if (await onboardingShown(shell)) throw new Error("onboarding is already showing before the shortcut");
      const { settings, window } = await openSettingsWindow(desktop, app, shell, { pane: "Keyboard Shortcuts" });
      await scrollToText(desktop, window, settings, "Show Onboarding");
      const lines = await paneLines(settings);
      const recorded = lines[lines.indexOf("Show Onboarding") + 1];
      if (recorded !== SHORTCUT_LABEL) throw new Error(`after the restart Show Onboarding's shortcut is ${JSON.stringify(recorded)}, not ${SHORTCUT_LABEL}`);
      await clickTextIn(desktop, window, settings, "Keyboard Shortcuts");
      const focus = await until(() => settings.eval("document.hasFocus() ? (document.activeElement?.tagName ?? 'BODY') : false"), { timeout: 5000, label: "Settings to take keyboard focus from a click on its sidebar" });
      if (/^(INPUT|TEXTAREA)$/.test(focus)) throw new Error(`a text field (${focus}) has focus in Settings`);
      await desktop.key(SHORTCUT);
      const shown = await until(() => onboardingShown(shell), { timeout: 8000, label: "onboarding in the browser window" }).catch(() => false);
      await desktopShot(t, desktop, "replay-from-settings");
      const settingsText = (await paneLines(settings)).join("\n");
      const inSettings = REPLAY_MARKS.some((m) => settingsText.includes(m));
      if (!shown) throw new Error(`nothing played after ${SHORTCUT_LABEL} in Settings (onboarding in Settings: ${inSettings}); windows ${JSON.stringify((await desktop.windows()).map((w) => w.title))}`);
      return { shown, recorded, focus };
    });
    await t.stop(app);
  },
};
