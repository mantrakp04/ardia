import { readFile } from "node:fs/promises";
import { navigateTab, startBrowser } from "../lib/flows.mjs";
import { evaluate } from "../lib/cdp.mjs";
import { openPage } from "../lib/pages.mjs";
import { js, nonce, until } from "../lib/util.mjs";
import { AUTOPLAY_ARGS, mediaPage, startTone, viewCall } from "./f15-media.mjs";

const discarded = (shell, tabId) => shell.eval(`!!ardiaLinux.lifecycle.state.getState().discarded[${js(tabId)}]`);

export const POLICY_LOCK = "ardia.linux.tab-policies";

const policyLocks = (shell) => shell.eval(`navigator.locks.query().then((q) => ({ held: q.held.filter((l) => l.name === ${js(POLICY_LOCK)}).length, pending: q.pending.filter((l) => l.name === ${js(POLICY_LOCK)}).length }))`);

export default {
  id: "F18",
  issue: 28,
  title: "Tab sleep, freeze protections and battery-aware system state on Linux",
  deadline: 300000,
  manual: [
    { name: "Memory pressure", steps: ["Run a memory hog until tasks stall on reclaim (stress-ng --vm 4 --vm-bytes 95%, or a cgroup with a low memory.high).", "Within 2 s memoryPressure reports warning (critical once full stalls pass 10%), idle background tabs sleep on the next sweep, and it falls back to normal a few seconds after the hog stops."], reason: "needs real memory pressure" },
  ],
  async run(t) {
    const run = nonce("f18");
    const state = await startBrowser(t, { name: "policies", extraArgs: AUTOPLAY_ARGS });
    const { shell } = state;
    const { url } = t.fixtures;

    await t.check("system state reports memory and an explicit power source", async () => {
      const reply = await shell.call("engine.systemState", {});
      if (!reply.ok) throw new Error(`engine.systemState failed: ${reply.code} ${reply.message}`);
      const value = reply.value;
      if (!["normal", "warning", "critical"].includes(value.memoryPressure) || !(value.physicalMemory > 0)) throw new Error(JSON.stringify(value));
      const psi = await readFile("/proc/pressure/memory", "utf8").then((text) => text.startsWith("some "), () => false);
      if (value.memorySignal !== (psi ? "psi" : "meminfo")) throw new Error(`memory signal ${value.memorySignal}, PSI ${psi ? "available" : "unavailable"}`);
      if (!["upower", "unavailable"].includes(value.power)) throw new Error(`power source ${value.power}`);
      if (value.power === "unavailable" && (value.onBattery !== false || value.batteryLevel !== null)) throw new Error(`unavailable power reported a battery: ${JSON.stringify(value)}`);
      return value;
    }, { critical: true });

    const first = await shell.newTab(url.page(1, run));
    await shell.waitTabUrl(first, (u) => u === url.page(1, run));
    await navigateTab(shell, first, url.page(2, run));
    const visible = await shell.newTab(url.page(3, run));
    await shell.waitTabUrl(visible, (u) => u === url.page(3, run));

    await t.check("the visible tab refuses discard and freeze", async () => {
      const discard = await viewCall(shell, visible, "discard()");
      const frozen = await viewCall(shell, visible, "setFrozen(true)");
      const unload = await viewCall(shell, visible, "discard({ unload: true })");
      if (discard !== "refused" || frozen !== false || unload !== "unsupported") throw new Error(`discard=${discard} frozen=${frozen} unload=${unload}`);
      return { discard, frozen, unload };
    });
    await t.check("an idle background tab reports clean input and sleeps", async () => {
      const unsaved = await viewCall(shell, first, "unsavedInput()");
      if (unsaved !== false) throw new Error(`unsavedInput returned ${JSON.stringify(unsaved)}`);
      const slept = await viewCall(shell, first, "discard()");
      if (slept !== "discarded") throw new Error(`discarding an idle background tab returned ${slept}`);
      await until(() => discarded(shell, first), { timeout: 8000, label: "the shared sleeping state" });
      const again = await viewCall(shell, first, "discard()");
      if (again !== "already") throw new Error(`a second discard returned ${again}`);
      const tab = await shell.tab(first);
      if (!tab || tab.url !== url.page(2, run)) throw new Error(`the Ardia tab changed: ${JSON.stringify(tab?.url)}`);
      return { again };
    }, { critical: true });
    await t.check("activating the sleeping tab wakes it with navigation intact", async () => {
      await shell.state(`s.activate(${js(first)}); return true;`);
      await until(async () => !(await discarded(shell, first)), { timeout: 15000, label: "the tab to wake" });
      await shell.waitTabUrl(first, (u) => u === url.page(2, run), { label: "the woken page" });
      await until(() => shell.state(`return !!s.live[${js(first)}]?.canGoBack;`), { timeout: 10000, label: "back history after waking" });
      return true;
    });
    await t.check("dirty form input protects a background tab", async () => {
      const formUrl = url.media(`${run}-form`);
      const form = await shell.newTab(formUrl);
      await shell.waitTabUrl(form, (u) => u === formUrl);
      const page = await mediaPage(state, formUrl);
      await page.send("Runtime.evaluate", { expression: "document.getElementById('field').focus()", userGesture: true });
      await page.send("Input.insertText", { text: "unsaved draft" });
      await until(async () => (await viewCall(shell, form, "unsavedInput()")) === true, { timeout: 8000, label: "native unsaved input" });
      await shell.state(`s.activate(${js(visible)}); return true;`);
      const discard = await viewCall(shell, form, "discard()");
      const frozen = await viewCall(shell, form, "setFrozen(true)");
      if (discard !== "refused" || frozen !== false) throw new Error(`discard=${discard} frozen=${frozen}`);
      return { discard, frozen };
    });
    await t.check("an audible background tab is protected and stays playing", async () => {
      const mediaUrl = url.media(`${run}-tone`);
      const tone = await shell.newTab(mediaUrl);
      await shell.waitTabUrl(tone, (u) => u === mediaUrl);
      const page = await mediaPage(state, mediaUrl);
      await startTone(page);
      await until(() => shell.state(`return !!s.live[${js(tone)}]?.playingAudio;`), { timeout: 15000, label: "audible tab" });
      await shell.state(`s.activate(${js(visible)}); return true;`);
      const discard = await viewCall(shell, tone, "discard()");
      if (discard !== "refused") throw new Error(`discard=${discard}`);
      return { discard };
    });

    await t.check("keys typed into a page reach the shell's idle clock as native input activity", async () => {
      await shell.eval("(() => { window.__ardiaActivity = 0; __ardiaHost.onEvent((module, _event, payload) => { if (module === 'ArdiaEngine' && payload?.name === 'engine.inputActivity') window.__ardiaActivity++; }); return true; })()");
      const page = await openPage(shell, url.page(4, `${run}-activity`));
      await evaluate(page.session, "document.body.tabIndex = 0, document.body.focus(), true");
      for (let i = 0; i < 3; i++) {
        await page.session.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", text: "a" });
        await page.session.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA" });
      }
      const seen = await until(() => shell.eval("window.__ardiaActivity || false"), { timeout: 8000, label: "engine.inputActivity in the shell" });
      return { seen };
    });

    await t.check("with two windows open exactly one holds the tab-policy lock and the other waits", async () => {
      const before = await shell.windowIds();
      await shell.command("newWindow");
      const windowId = await until(async () => (await shell.windowIds()).find((id) => !before.includes(id)) ?? false, { timeout: 20000, label: "the second window" });
      const second = await state.app.shell(windowId, { timeout: 25000 });
      const locks = await until(async () => { const l = await policyLocks(second); return l.held === 1 && l.pending === 1 ? l : false; }, { timeout: 15000, label: "one held and one pending tab-policy lock" });
      const fromFirst = await policyLocks(shell);
      if (fromFirst.held !== 1) throw new Error(`the first window sees ${JSON.stringify(fromFirst)}`);
      return locks;
    });
  },
};
