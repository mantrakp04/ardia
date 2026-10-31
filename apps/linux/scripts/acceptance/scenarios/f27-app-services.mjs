import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { launchStepsComplete } from "../lib/assertions.mjs";
import { restartBrowser, startBrowser } from "../lib/flows.mjs";
import { documentDirectory, sessionSeed } from "../lib/seed.mjs";
import { until } from "../lib/util.mjs";

const INTRO_MARK = "Your new home on the internet";
const ONBOARDING_MARKS = [INTRO_MARK, "Where are you coming from?", "Where's the address bar?", "Where do your tabs go?"];
const showsOnboarding = async (shell) => {
  const text = await shell.text();
  return ONBOARDING_MARKS.some((mark) => text.includes(mark));
};

async function onboardingDocument(scratch) {
  const text = await readFile(join(documentDirectory(scratch), "onboarding.json"), "utf8").catch(() => null);
  try { return text ? JSON.parse(text) : null; } catch { return { unreadable: text }; }
}

async function regularShells(app, count) {
  const shells = await until(async () => {
    const list = (await app.shells()).filter((s) => s.ready && !s.utility);
    return list.length >= count ? list : false;
  }, { timeout: 25000, label: `${count} browser renderers` });
  return Promise.all(shells.map((s) => app.shell(s.windowId)));
}

async function launchClaims(shells) {
  const steps = await shells[0].eval("window.__ardiaHost.invoke('ArdiaShell.launchSteps', { args: [] })");
  const marks = await Promise.all(shells.map((s) => s.eval("sessionStorage.getItem('ardia.linux.app-launch')")));
  return { steps, marks };
}

export default {
  id: "F27",
  issue: 37,
  title: "Onboarding starts once on a fresh profile and app services run once per launch",
  deadline: 300000,
  manual: [
    { name: "Finishing onboarding through its steps", steps: ["On a fresh profile, click through every onboarding step to the end.", "Restart: onboarding does not return, and Help › Show Onboarding replays it on demand."], reason: "automated in F27D; step 7's Continue never enables (#258)" },
    { name: "Setup choices apply across windows", steps: ["On a fresh profile, finish onboarding choosing a non-default search engine, the top tab layout and two pinned sites.", "Open a second window: it shows the same layout and pins; Settings › Search shows the chosen engine; no duplicate pins appear after a restart."], reason: "automated in F27D" },
    { name: "Onboarding and tours from a utility window", steps: ["Open Settings and run Help › Show Onboarding and Help › Tool Tour from it.", "They play in a browser window, not inside Settings."], reason: "automated in F27D for Show Onboarding (fails, #37); Tool Tour isn't driven" },
  ],
  async run(t) {
    let fresh;
    await t.check("a fresh profile starts onboarding once in the startup window", async () => {
      const scratch = await t.scratch("fresh");
      fresh = await startBrowser(t, { scratch, label: "fresh" });
      await until(() => showsOnboarding(fresh.shell), { timeout: 20000, label: "onboarding overlay" });
      const doc = await until(() => onboardingDocument(scratch).then((d) => d?.startedAt ? d : false), { timeout: 10000, label: "onboarding.json startedAt" });
      const claims = await until(() => launchClaims([fresh.shell]).then((c) => launchStepsComplete(c.steps) ? c : false), { timeout: 10000, label: "recorded launch steps" });
      if (claims.marks[0] !== "ran") throw new Error(`the startup renderer did not run the launch steps ${JSON.stringify(claims)}`);
      return { doc, claims };
    }, { critical: true });
    await t.check("an unfinished onboarding resumes after restart without replaying the intro", async () => {
      await until(async () => (await fresh.shell.text()).includes("Where are you coming from?"), { timeout: 25000, label: "the intro to hand over to the first step" });
      fresh = await restartBrowser(t, fresh);
      await until(() => showsOnboarding(fresh.shell), { timeout: 15000, label: "resumed onboarding" });
      if ((await fresh.shell.text()).includes(INTRO_MARK)) throw new Error("a resumed onboarding replayed the intro");
      return { doc: await onboardingDocument(fresh.scratch) };
    });
    await t.check("a completed onboarding never shows again", async () => {
      await t.stop(fresh.app);
      const doc = (await onboardingDocument(fresh.scratch)) ?? {};
      await writeFile(join(documentDirectory(fresh.scratch), "onboarding.json"), JSON.stringify({ ...doc, completedAt: Date.now(), version: doc.version ?? 1 }));
      fresh = await startBrowser(t, { scratch: fresh.scratch, label: "completed" });
      await new Promise((resolve) => setTimeout(resolve, 3000));
      if (await showsOnboarding(fresh.shell)) throw new Error("onboarding reappeared after it was completed");
      return true;
    });
    await t.stop(fresh.app);

    let existing;
    await t.check("an existing two-window profile never onboards and runs launch services once", async () => {
      const session = sessionSeed({ windows: [{ id: "main", urls: [t.fixtures.url.page(1, "existing-main")] }, { id: "existing-b", urls: [t.fixtures.url.page(2, "existing-b")] }] });
      existing = await startBrowser(t, { name: "existing", session, onboardingComplete: false });
      const shells = await regularShells(existing.app, 2);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const shown = [];
      for (const shell of shells) if (await showsOnboarding(shell)) shown.push(shell.windowId);
      if (shown.length) throw new Error(`onboarding shown in ${shown.join(", ")}`);
      const claims = await until(() => launchClaims(shells).then((c) => launchStepsComplete(c.steps) ? c : false), { timeout: 10000, label: "recorded launch steps" });
      if (claims.marks.filter(Boolean).length !== 1) throw new Error(`expected one renderer to run launch services, saw ${JSON.stringify(claims.marks)}`);
      const doc = await until(() => onboardingDocument(existing.scratch).then((d) => d?.completedAt ? d : false), { timeout: 10000, label: "existing profile marked complete" });
      const reloaded = shells[claims.marks.findIndex(Boolean)];
      await reloaded.session.send("Page.reload");
      await new Promise((resolve) => setTimeout(resolve, 4000));
      const again = await existing.app.shell(reloaded.windowId, { timeout: 20000 });
      if (await showsOnboarding(again)) throw new Error("a reloaded renderer started onboarding");
      return { claims, doc, windows: shells.map((s) => s.windowId) };
    });
    await t.check("an app command without a Linux backend answers in its own window", async () => {
      const shells = await regularShells(existing.app, 2);
      const [asking, other] = shells;
      await asking.command("releaseNotes");
      const toast = "Not available on Linux yet";
      const opened = await until(async () => {
        if ((await asking.text()).includes(toast)) return "toast";
        const tabs = await asking.state("return Object.values(s.tabs).filter(t => t.windowId === windowId && /release/i.test(t.url ?? '')).length;");
        return tabs ? "page" : false;
      }, { timeout: 8000, label: "release notes answer" });
      if (other && (await other.text()).includes(toast)) throw new Error("the answer appeared in another window");
      return { opened, window: asking.windowId };
    });
  },
};
