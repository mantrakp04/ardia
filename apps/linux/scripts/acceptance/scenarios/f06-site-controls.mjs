import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { evaluate } from "../lib/cdp.mjs";
import { navigateTab, restartBrowser, startBrowser } from "../lib/flows.mjs";
import { nonce, until } from "../lib/util.mjs";

export const BLOCKER_DIR = process.env.ARDIA_ACCEPTANCE_CONTENT_BLOCKER;
export const extraArgs = BLOCKER_DIR ? [`--ardia-content-blocker-dir=${BLOCKER_DIR}`] : [];

export function blockerAvailable(t) {
  if (BLOCKER_DIR) return true;
  const executable = t.options?.executable;
  if (!executable) return false;
  try {
    return existsSync(join(dirname(realpathSync(executable)), "..", "lib", "ardia", "extensions", "ublock", "manifest.json"));
  } catch {
    return false;
  }
}

export async function call(shell, name, args = {}, profile = "") {
  const reply = await shell.call(name, args, profile);
  if (!reply.ok) throw new Error(`${name} failed: ${reply.code} ${reply.message}`);
  return reply.value;
}

export async function pageEval(app, url, expression) {
  const session = await app.connect(await app.pageLoaded(url, { prefix: true }));
  return evaluate(session, expression);
}

const PERMISSION_STATES = `Promise.all(["notifications", "geolocation", "camera"].map((name) => navigator.permissions.query({ name }).then((s) => [name, s.state], () => [name, "unsupported"]))).then(Object.fromEntries)`;

async function permissionStates(state, tabId, url) {
  await navigateTab(state.shell, tabId, url);
  return pageEval(state.app, url, PERMISSION_STATES);
}

async function waitPermissions(state, tabId, url, want, label) {
  let last;
  await until(async () => {
    last = await permissionStates(state, tabId, `${url}?check=${nonce("p")}`);
    return Object.entries(want).every(([name, value]) => last[name] === value);
  }, { timeout: 15000, label: `${label}: ${JSON.stringify(want)}` }).catch((error) => { throw new Error(`${error.message}; page saw ${JSON.stringify(last)}`); });
  return last;
}

async function storageOf(state, tabId, host, t) {
  const url = `${t.fixtures.url.storage(host)}?read=${nonce("s")}`;
  await navigateTab(state.shell, tabId, url);
  return pageEval(state.app, url, "({ cookie: document.cookie, storage: Object.keys(localStorage).sort() })");
}

async function setStorage(state, tabId, host, name, t) {
  const url = t.fixtures.url.storage(host, name);
  await navigateTab(state.shell, tabId, url);
  await until(async () => (await pageEval(state.app, url, "document.cookie")).includes(`${name}=1`), { timeout: 8000, label: `${name} cookie on ${host}` });
}

const hasCookie = (seen, name) => seen.cookie.split(/;\s*/).includes(`${name}=1`);

function adRequests(t, run) {
  return t.fixtures.requests.filter((r) => r.path === `/ads/banners/${run}.png`).length;
}

export async function loadBlockerPage(state, tabId, host, t) {
  const run = nonce("ad");
  const url = t.fixtures.url.blocker(host, run);
  await navigateTab(state.shell, tabId, url);
  await until(() => t.fixtures.requests.some((r) => r.query.blocker === run), { timeout: 10000, label: "the control image request" });
  await new Promise((resolve) => setTimeout(resolve, 600));
  const images = await pageEval(state.app, url, "({ ad: document.getElementById('ad').naturalWidth, control: document.getElementById('control').naturalWidth })");
  return { run, requests: adRequests(t, run), images };
}

export async function expectBlocked(state, tabId, host, t, blocked, label) {
  let last;
  await until(async () => {
    last = await loadBlockerPage(state, tabId, host, t);
    return blocked ? last.requests === 0 && last.images.ad === 0 : last.requests > 0;
  }, { timeout: 30000, label }).catch((error) => { throw new Error(`${error.message}; last ${JSON.stringify(last)}`); });
  return last;
}

export async function blockerReady(shell) {
  let last;
  return until(async () => {
    last = await call(shell, "contentBlocker.state");
    return last?.stats?.ready && last.lists.length > 0 ? last : false;
  }, { timeout: 60000, label: "the content blocker to report ready" }).catch((error) => { throw new Error(`${error.message}; last ${JSON.stringify(last?.stats ?? last)}`); });
}

export default {
  id: "F06",
  issue: 16,
  title: "Site permissions, browsing-data clearing and the content blocker act on the engine",
  deadline: 480000,
  async run(t) {
    let state = await startBrowser(t, { name: "site-controls", extraArgs });
    const blank = t.fixtures.url.page(1, nonce("f06"));
    const tabId = await state.shell.newTab(blank);
    await state.shell.waitTabUrl(tabId, (u) => u === blank);
    const origin = t.fixtures.url.permissionsOrigin();
    const permissionsUrl = t.fixtures.url.permissions();

    await t.check("granted and blocked permissions are what the page sees after reload", async () => {
      const before = await waitPermissions(state, tabId, permissionsUrl, { notifications: "prompt", geolocation: "prompt" }, "default permissions");
      await call(state.shell, "sites.setSetting", { origin, type: "notifications", value: "allow", engine: "chromium" });
      await call(state.shell, "sites.setSetting", { origin, type: "location", value: "block", engine: "chromium" });
      await call(state.shell, "sites.setSetting", { origin, type: "camera", value: "allow", engine: "chromium" });
      const after = await waitPermissions(state, tabId, permissionsUrl, { notifications: "granted", geolocation: "denied", camera: "granted" }, "changed permissions");
      const settings = await call(state.shell, "sites.settings", { origin, engine: "chromium" });
      if (settings.notifications?.value !== "allow" || settings.notifications.isDefault || settings.location?.value !== "block")
        throw new Error(`sites.settings ${JSON.stringify(settings)}`);
      const origins = await call(state.shell, "sites.origins");
      if (!origins.includes(origin)) throw new Error(`sites.origins ${JSON.stringify(origins)}`);
      return { before, after };
    });

    await t.check("permissions survive a restart", async () => {
      state = await restartBrowser(t, state, { extraArgs });
      const again = await state.shell.newTab(blank);
      await state.shell.waitTabUrl(again, (u) => u === blank);
      const seen = await waitPermissions(state, again, permissionsUrl, { notifications: "granted", geolocation: "denied", camera: "granted" }, "permissions after restart");
      state.tabId = again;
      return seen;
    });
    const tab = () => state.tabId ?? tabId;

    await t.check("revoking one permission and resetting the site return the page to prompt", async () => {
      await call(state.shell, "sites.setSetting", { origin, type: "camera", value: "default", engine: "chromium" });
      const revoked = await waitPermissions(state, tab(), permissionsUrl, { camera: "prompt", notifications: "granted" }, "camera revoked");
      await call(state.shell, "sites.reset", { origin });
      const reset = await waitPermissions(state, tab(), permissionsUrl, { notifications: "prompt", geolocation: "prompt", camera: "prompt" }, "site reset");
      const origins = await call(state.shell, "sites.origins");
      if (origins.includes(origin)) throw new Error(`still listed: ${JSON.stringify(origins)}`);
      return { revoked, reset };
    });

    await t.check("private sessions and invalid requests are refused, never applied to the regular profile", async () => {
      const privateReply = await state.shell.call("sites.setSetting", { origin, type: "camera", value: "allow" }, "incognito:f06@default");
      const badOrigin = await state.shell.call("sites.setSetting", { origin: "chrome://settings", type: "camera", value: "allow" });
      const badClear = await state.shell.call("profiles.clearBrowsingData", { types: ["passwords"], since: null });
      if (privateReply.code !== "ERR_PROFILE_WINDOW" || badOrigin.code !== "ERR_SITE_REQUEST" || badClear.code !== "ERR_SITE_REQUEST")
        throw new Error(JSON.stringify({ privateReply, badOrigin, badClear }));
      const settings = await call(state.shell, "sites.settings", { origin });
      if (!settings.camera?.isDefault) throw new Error(`camera changed: ${JSON.stringify(settings.camera)}`);
      return { privateReply: privateReply.code, badOrigin: badOrigin.code, badClear: badClear.code };
    });

    await t.check("clearing one site's data removes only its cookies and storage", async () => {
      await setStorage(state, tab(), "data.ardia.test", "f06data", t);
      await setStorage(state, tab(), "www.ardia-keep.test", "f06keep", t);
      const cleared = await call(state.shell, "sites.clearData", { origin: `http://data.ardia.test:${t.fixtures.ports.http}` });
      const data = await storageOf(state, tab(), "data.ardia.test", t);
      const kept = await storageOf(state, tab(), "www.ardia-keep.test", t);
      if (hasCookie(data, "f06data") || data.storage.includes("f06data")) throw new Error(`data.ardia.test kept ${JSON.stringify(data)}`);
      if (!hasCookie(kept, "f06keep") || !kept.storage.includes("f06keep")) throw new Error(`www.ardia-keep.test lost ${JSON.stringify(kept)}`);
      return { cleared, data, kept };
    });

    await t.check("a time-scoped clear removes cookies set after the start time and keeps older ones", async () => {
      await setStorage(state, tab(), "older.ardia.test", "f06older", t);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const since = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 500));
      await setStorage(state, tab(), "newer.ardia.test", "f06newer", t);
      await call(state.shell, "profiles.clearBrowsingData", { types: ["siteData"], since });
      const older = await storageOf(state, tab(), "older.ardia.test", t);
      const newer = await storageOf(state, tab(), "newer.ardia.test", t);
      if (!hasCookie(older, "f06older")) throw new Error(`the older cookie was removed: ${JSON.stringify(older)}`);
      if (hasCookie(newer, "f06newer")) throw new Error(`the newer cookie survived: ${JSON.stringify(newer)}`);
      return { since, older, newer };
    });

    await t.check("Cancel in Clear Browsing Data keeps everything", async () => {
      await state.shell.command("clearBrowsingData");
      await state.shell.clickText("Cancel", { timeout: 10000 });
      await until(async () => !(await state.shell.text()).includes("Cookies, site data and cached files"), { timeout: 6000, label: "the dialog to close" });
      const kept = await storageOf(state, tab(), "www.ardia-keep.test", t);
      if (!hasCookie(kept, "f06keep")) throw new Error(`Cancel cleared data: ${JSON.stringify(kept)}`);
      return kept;
    });

    await t.check("Clear Data for the last hour removes history, cookies and site storage", async () => {
      const visited = t.fixtures.url.page(6, nonce("history"));
      await navigateTab(state.shell, tab(), visited);
      await until(async () => (await call(state.shell, "history.query", { maxUrls: 500, maxVisits: 1 })).entries.some((e) => e.u === visited), { timeout: 15000, label: "the visit in history" });
      await state.shell.command("clearBrowsingData");
      await state.shell.clickText("Clear Data", { timeout: 10000 });
      await until(async () => !(await state.shell.text()).includes("Cookies, site data and cached files"), { timeout: 15000, label: "the dialog to finish" });
      const kept = await until(async () => {
        const seen = await storageOf(state, tab(), "www.ardia-keep.test", t);
        return hasCookie(seen, "f06keep") || seen.storage.includes("f06keep") ? false : seen;
      }, { timeout: 15000, label: "www.ardia-keep.test data to be gone" });
      const entries = (await call(state.shell, "history.query", { maxUrls: 500, maxVisits: 1 })).entries;
      if (entries.some((e) => e.u === visited)) throw new Error("the visit is still in history");
      return { kept, history: entries.length };
    });

    const ready = await t.check("the content blocker loads and reports its filter lists", async () => {
      const blocker = await blockerReady(state.shell);
      const easylist = blocker.lists.find((l) => l.id === "easylist");
      if (!blocker.enabled || !easylist?.enabled) throw new Error(`blocking or EasyList off: ${JSON.stringify({ enabled: blocker.enabled, easylist })}`);
      return { version: blocker.version, lists: blocker.lists.length, stats: blocker.stats };
    });
    if (!ready.ok) return;

    await t.check("an EasyList-matched image never reaches the network", async () => expectBlocked(state, tab(), "news.ardia.test", t, true, "the ad image to be blocked"));

    await t.check("a site exception lets the image through, covers subdomains and announces the change", async () => {
      await state.shell.eval("(() => { window.__f06Events = []; __ardiaHost.onEvent((module, event, payload) => { if (module === 'ArdiaContentBlocker') window.__f06Events.push(payload?.name); }); return true; })()");
      await call(state.shell, "contentBlocker.setAllowed", { host: "news.ardia.test", allowed: true });
      const loaded = await expectBlocked(state, tab(), "news.ardia.test", t, false, "the ad image to load on the excepted site");
      const sub = await call(state.shell, "contentBlocker.isAllowed", { host: "www.news.ardia.test" });
      const elsewhere = await expectBlocked(state, tab(), "other.ardia.test", t, true, "other sites to stay blocked");
      const events = await until(() => state.shell.eval("window.__f06Events"), { timeout: 8000, label: "contentBlocker.changed", interval: 200 }).then((list) => (list.includes("contentBlocker.changed") ? list : Promise.reject(new Error(JSON.stringify(list)))));
      const listed = (await call(state.shell, "contentBlocker.state")).allowedHosts;
      if (!sub || !listed.includes("news.ardia.test")) throw new Error(JSON.stringify({ sub, listed }));
      return { loaded, elsewhere, events, listed };
    });

    await t.check("the site exception and blocking survive a restart", async () => {
      state = await restartBrowser(t, state, { extraArgs });
      state.tabId = await state.shell.newTab(blank);
      await state.shell.waitTabUrl(state.tabId, (u) => u === blank);
      await blockerReady(state.shell);
      const excepted = await expectBlocked(state, tab(), "news.ardia.test", t, false, "the exception after restart");
      const blocked = await expectBlocked(state, tab(), "other.ardia.test", t, true, "blocking after restart");
      return { excepted, blocked };
    });

    await t.check("Block Again removes the exception", async () => {
      await call(state.shell, "contentBlocker.setAllowed", { host: "news.ardia.test", allowed: false });
      return expectBlocked(state, tab(), "news.ardia.test", t, true, "the image to be blocked again");
    });

    await t.check("turning blocking off lets the image through and turning it on blocks it again", async () => {
      await call(state.shell, "contentBlocker.setEnabled", { enabled: false });
      const off = await expectBlocked(state, tab(), "news.ardia.test", t, false, "blocking off");
      if ((await call(state.shell, "contentBlocker.state")).enabled) throw new Error("state still reports enabled");
      await call(state.shell, "contentBlocker.setEnabled", { enabled: true });
      const on = await expectBlocked(state, tab(), "news.ardia.test", t, true, "blocking on");
      return { off, on };
    });

    await t.check("turning EasyList off and on changes what is blocked", async () => {
      await call(state.shell, "contentBlocker.setListEnabled", { id: "easylist", enabled: false });
      const off = await expectBlocked(state, tab(), "news.ardia.test", t, false, "EasyList off");
      const listed = (await call(state.shell, "contentBlocker.state")).lists.find((l) => l.id === "easylist");
      await call(state.shell, "contentBlocker.setListEnabled", { id: "easylist", enabled: true });
      const on = await expectBlocked(state, tab(), "news.ardia.test", t, true, "EasyList on");
      if (listed?.enabled !== false) throw new Error(`state showed ${JSON.stringify(listed)}`);
      return { off, on };
    });

    await t.check("invalid blocker requests are refused", async () => {
      const directive = await state.shell.call("contentBlocker.setAllowed", { host: "/^(?:ardia-blocking-off|)/", allowed: true });
      const list = await state.shell.call("contentBlocker.setListEnabled", { id: "../easylist", enabled: true });
      if (directive.code !== "ERR_CONTENT_BLOCKER_REQUEST" || list.code !== "ERR_CONTENT_BLOCKER_REQUEST") throw new Error(JSON.stringify({ directive, list }));
      const state2 = await call(state.shell, "contentBlocker.state");
      if (!state2.enabled) throw new Error("the off directive got through");
      return { directive: directive.code, list: list.code };
    });
  },
};
