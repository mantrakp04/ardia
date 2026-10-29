import { connectCdp, evaluate } from "../lib/cdp.mjs";
import { startBrowser } from "../lib/flows.mjs";
import { until } from "../lib/util.mjs";
import { blockerAvailable, blockerReady, extraArgs } from "./f06-site-controls.mjs";

const EXTENSION = "fajbdaomknpkicfjcpipdmcpoamdmilh";

export default {
  id: "S107",
  issue: 107,
  title: "Ardia's uBlock Origin component can't script chrome:// pages, including the shell",
  deadline: 180000,
  manual: [],
  async run(t) {
    if (!blockerAvailable(t)) {
      await t.check("the content blocker is packaged", () => {
        throw new Error("set ARDIA_ACCEPTANCE_CONTENT_BLOCKER to the uBlock Origin build from scripts/linux/fetch-ubo.sh");
      });
      return;
    }
    const state = await startBrowser(t, { name: "restricted", extraArgs });
    await blockerReady(state.shell);
    const background = await t.check("uBlock Origin's background page is reachable", async () => {
      const target = await until(async () => (await state.app.targets()).find((x) => x.url.startsWith(`chrome-extension://${EXTENSION}/`) && x.type === "background_page"), { timeout: 20000, label: "the uBlock Origin background page" });
      return { url: target.url };
    }, { critical: true });

    await t.check("tabs.executeScript into a chrome:// tab is refused", async () => {
      const tabId = await state.shell.newTab("chrome://version/");
      await state.shell.waitTabUrl(tabId, (u) => /^(chrome|ardia):\/\/version/.test(u), { timeout: 15000 });
      const target = (await state.app.targets()).find((x) => x.url === background.detail.url);
      const session = await state.app.connect(target);
      const outcome = await evaluate(session, `new Promise((resolve) => chrome.tabs.query({}, (tabs) => {
        const tab = tabs.find((x) => (x.url || '').startsWith('chrome://version'));
        if (!tab) return resolve({ error: 'no chrome://version tab', tabs: tabs.map((x) => x.url) });
        chrome.tabs.executeScript(tab.id, { code: 'document.title' }, (result) => resolve({ result: result ?? null, error: chrome.runtime.lastError ? chrome.runtime.lastError.message : null }));
      }))`, { timeout: 15000 });
      if (outcome.error === "no chrome://version tab") throw new Error(JSON.stringify(outcome));
      if (!outcome.error || outcome.result) throw new Error(`the component scripted a chrome:// page: ${JSON.stringify(outcome)}`);
      return outcome;
    });

    await t.check("no uBlock Origin script context exists in the chrome://ardia/ shell", async () => {
      const target = (await state.app.targets()).find((x) => x.type === "page" && x.url.startsWith("chrome://ardia/"));
      const session = await connectCdp(target.webSocketDebuggerUrl);
      const contexts = [];
      session.on("Runtime.executionContextCreated", ({ context }) => contexts.push({ origin: context.origin, name: context.name, type: context.auxData?.type ?? null }));
      try {
        await session.send("Runtime.enable");
        await new Promise((resolve) => setTimeout(resolve, 500));
      } finally {
        await session.close();
      }
      const ours = contexts.filter((c) => (c.origin || "").includes(EXTENSION));
      if (ours.length) throw new Error(JSON.stringify(ours));
      return { contexts: contexts.length };
    });
  },
};
