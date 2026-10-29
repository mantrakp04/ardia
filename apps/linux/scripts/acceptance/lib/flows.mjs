import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { sessionPath, sessionSeed, writeChromePreferences, writeProfileSeed } from "./seed.mjs";
import { evaluate } from "./cdp.mjs";
import { js, until } from "./util.mjs";

export async function startBrowser(t, { name = "profile", scratch, seed = true, session, onboardingComplete = true, preferences, background = true, extensions, extraArgs, env, ozone, label, coreDumps, settle = true } = {}) {
  const dir = scratch ?? (await t.scratch(name));
  if (!scratch) {
    await writeProfileSeed(dir, { session: seed ? (session ?? sessionSeed()) : undefined, onboardingComplete });
    if (preferences) await writeChromePreferences(dir, preferences);
  }
  const fresh = await access(join(dir, "Default", "Preferences")).then(() => false, () => true);
  const app = await t.launch({ scratch: dir, background, extensions, extraArgs, env, ozone, coreDumps, label: label ?? name });
  const shell = await app.mainShell();
  const hold = fresh && settle ? await settleNavigationHold(app, shell) : null;
  return { app, shell, scratch: dir, hold };
}

export async function settleNavigationHold(app, shell, { timeout = 25000 } = {}) {
  let answer = null;
  let pending = null;
  return until(async () => {
    if (/held navigations go ahead/.test(await app.logText())) return "timed out";
    if (answer?.ok && answer.value?.stats?.ready) return "ready";
    if (answer && !answer.ok && /not installed|didn't load/.test(answer.message)) return "no blocker";
    pending ??= shell.call("contentBlocker.state").then((reply) => { answer = reply; }, () => {}).finally(() => { pending = null; });
    return false;
  }, { timeout, interval: 250, label: "the content blocker's navigation hold to end", abort: () => app.exitReason() }).catch(() => "unsettled");
}

export async function restartBrowser(t, current, options = {}) {
  await t.stop(current.app);
  return startBrowser(t, { ...options, scratch: current.scratch, label: options.label ?? "restart" });
}

export async function navigateTab(shell, tabId, url, { timeout = 25000, match = (current) => current === url, committed = false } = {}) {
  await shell.navigate(tabId, url);
  await shell.waitTabUrl(tabId, match, { timeout, label: `tab ${tabId} to commit ${url}` });
  if (committed) await waitCommitted(shell, tabId, match, { timeout, label: url });
}

export async function waitCommitted(shell, tabId, match, { timeout = 25000, label = "" } = {}) {
  return until(async () => {
    const entries = await shell.eval(`(async () => (await ardiaLinux.webviews.get(${js(tabId)})?.navigationEntries()) ?? null)()`).catch(() => null);
    const current = Array.isArray(entries) ? entries.find((entry) => entry.current) : null;
    return current && match(current.url) ? current : false;
  }, { timeout, label: `Chromium to commit ${label} in tab ${tabId}`, abort: () => shell.app.exitReason() });
}

export async function readSavedSession(scratch) {
  const text = await readFile(sessionPath(scratch), "utf8").catch(() => null);
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export async function waitSavedSession(scratch, test, { timeout = 15000, label = "saved session" } = {}) {
  return until(async () => {
    const session = await readSavedSession(scratch);
    return session && test(session) ? session : false;
  }, { timeout, label });
}

export async function waitPageViewport(app, target, { timeout = 15000 } = {}) {
  const session = await app.connect(target);
  return until(async () => {
    const size = await evaluate(session, "({ width: innerWidth, height: innerHeight })", { timeout: 3000, userGesture: false }).catch(() => null);
    return size?.width > 0 && size.height > 0 ? size : false;
  }, { timeout, label: `page ${target.url} to get a viewport`, abort: () => app.exitReason() });
}
