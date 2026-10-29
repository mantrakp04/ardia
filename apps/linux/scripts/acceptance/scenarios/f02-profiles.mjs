import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { evaluate } from "../lib/cdp.mjs";
import { privateLeaks } from "../lib/assertions.mjs";
import { readSavedSession, restartBrowser, startBrowser, waitSavedSession } from "../lib/flows.mjs";
import { js, nonce, until } from "../lib/util.mjs";

const COOKIE = "ardia_acceptance";

export async function profilePage(app, shell, url) {
  const tabId = await shell.newTab(url);
  await shell.waitTabUrl(tabId, (current) => current === url, { label: `${shell.windowId} to load ${url}` });
  const target = await app.pageLoaded(url);
  const session = await app.connect(target);
  const info = (await app.browserTargets()).find((t) => t.targetId === target.id);
  return { tabId, target, session, browserContextId: info?.browserContextId ?? null };
}

const writeMarks = (session, value) => evaluate(session, `(() => { document.cookie = ${js(`${COOKIE}=${value}; max-age=3600; path=/`)}; localStorage.setItem('ardiaAcceptance', ${js(value)}); return { cookie: document.cookie, storage: localStorage.getItem('ardiaAcceptance') }; })()`);
const readMarks = (session) => evaluate(session, `({ cookie: document.cookie.split('; ').find(c => c.startsWith(${js(`${COOKIE}=`)}))?.split('=')[1] ?? null, storage: localStorage.getItem('ardiaAcceptance') })`);

export async function openProfileWindow(app, shell, body, label) {
  const before = await shell.windowIds();
  const windowId = await shell.state(body);
  if (typeof windowId !== "string") throw new Error(`${label} returned ${JSON.stringify(windowId)}`);
  await until(async () => (await shell.windowIds()).includes(windowId), { timeout: 20000, label: `${label} native window` });
  const other = await app.shell(windowId, { timeout: 25000 });
  return { windowId, shell: other, before };
}

export default {
  id: "F02",
  issue: 12,
  title: "Isolated profiles, shared-data profiles and private windows",
  deadline: 480000,
  manual: [
    { name: "Extensions stay per profile", steps: ["Install an unpacked extension in the default profile (chrome://extensions, developer mode).", "Open the isolated profile's window; the extension is absent from its toolbar and chrome://extensions.", "Install it in the isolated profile; uninstalling it there leaves the default profile's copy."], reason: "needs an extension install flow" },
    { name: "Settings panes reach the isolated profile's services", steps: ["Open Settings from the isolated profile's window.", "History, Passwords and Site Settings show only that profile's data."] },
  ],
  async run(t) {
    const run = nonce("f02");
    let state = await startBrowser(t, { name: "profiles" });
    const defaultUrl = t.fixtures.url.isolation("isolation.ardia.test") + `?p=default-${run}`;
    let defaultPage;
    await t.check("default profile stores a cookie and localStorage", async () => {
      defaultPage = await profilePage(state.app, state.shell, defaultUrl);
      return { context: defaultPage.browserContextId, marks: await writeMarks(defaultPage.session, `default-${run}`) };
    }, { critical: true });

    let isolated;
    await t.check("an isolated profile opens its own window and browser context", async () => {
      const profileId = await state.shell.state(`return s.createProfile({ name: ${js(`Isolated ${run}`)} });`);
      const opened = await openProfileWindow(state.app, state.shell, `return s.createWindow({ profileId: ${js(profileId)} });`, "isolated window");
      const page = await profilePage(state.app, opened.shell, t.fixtures.url.isolation("isolation.ardia.test") + `?p=isolated-${run}`);
      if (!page.browserContextId || page.browserContextId === defaultPage.browserContextId) throw new Error(`isolated page context ${page.browserContextId} matches default ${defaultPage.browserContextId}`);
      isolated = { profileId, ...opened, page };
      return { profileId, windowId: opened.windowId, pageProfile: opened.shell.pageProfile, context: page.browserContextId };
    });
    await t.check("isolated profile sees no default cookies or localStorage", async () => {
      const marks = await readMarks(isolated.page.session);
      if (marks.cookie || marks.storage) throw new Error(`leaked ${JSON.stringify(marks)}`);
      await writeMarks(isolated.page.session, `isolated-${run}`);
      const back = await readMarks(defaultPage.session);
      if (back.cookie !== `default-${run}` || back.storage !== `default-${run}`) throw new Error(`default profile now reads ${JSON.stringify(back)}`);
      return { isolated: await readMarks(isolated.page.session), default: back };
    });
    await t.check("history stays per profile", async () => {
      const urlOnlyIsolated = `${t.fixtures.url.page(7, `isolated-history-${run}`)}`;
      await isolated.shell.navigate(isolated.page.tabId, urlOnlyIsolated);
      await isolated.shell.waitTabUrl(isolated.page.tabId, (u) => u === urlOnlyIsolated);
      const seen = await until(() => isolated.shell.state(`const h = s.history[s.profiles[${js(isolated.profileId)}]?.dataId ?? ${js(isolated.profileId)}]?.list ?? []; return h.some(e => e?.url === ${js(urlOnlyIsolated)});`), { timeout: 20000, label: "isolated history entry" });
      const leaked = await state.shell.state(`const h = s.history[""]?.list ?? []; return h.some(e => e?.url === ${js(urlOnlyIsolated)});`);
      if (leaked) throw new Error("the isolated visit appeared in the default profile's history");
      return { seen };
    });
    await t.check("cross-profile tab creation is rejected by the host", async () => {
      const reply = await isolated.shell.invoke("tab.create", { key: `cross-${run}`, claim: `cross-claim-${run}`, profile: "default", url: "about:blank" });
      if (reply.ok) {
        await isolated.shell.invoke("tab.release", { id: reply.value?.browserId, claim: `cross-claim-${run}` });
        throw new Error("the isolated window accepted a default-profile tab");
      }
      if (!/ERR_PROFILE/.test(`${reply.code} ${reply.message}`)) throw new Error(`unexpected refusal ${JSON.stringify(reply)}`);
      return reply;
    });
    await t.check("a shared-data profile shares the default profile's data", async () => {
      const profileId = await state.shell.state(`return s.createProfile({ name: ${js(`Shared ${run}`)}, shareWith: "default" });`);
      const opened = await openProfileWindow(state.app, state.shell, `return s.createWindow({ profileId: ${js(profileId)} });`, "shared window");
      const page = await profilePage(state.app, opened.shell, t.fixtures.url.isolation("isolation.ardia.test") + `?p=shared-${run}`);
      const marks = await readMarks(page.session);
      if (marks.cookie !== `default-${run}` || marks.storage !== `default-${run}`) throw new Error(`shared profile reads ${JSON.stringify(marks)}`);
      if (page.browserContextId !== defaultPage.browserContextId) throw new Error("shared profile runs in another browser context");
      await opened.shell.eval("1");
      await opened.shell.state("s.closeWindow(windowId); return true;").catch(() => {});
      return { profileId, marks };
    });

    let privateWindow;
    await t.check("a private window runs off the record", async () => {
      const opened = await openProfileWindow(state.app, state.shell, `return s.createWindow({ kind: "private", profileId: "default" });`, "private window");
      const page = await profilePage(state.app, opened.shell, t.fixtures.url.isolation("isolation.ardia.test") + `?p=private-${run}`);
      if (!page.browserContextId || page.browserContextId === defaultPage.browserContextId) throw new Error("the private page shares the default browser context");
      const marks = await readMarks(page.session);
      if (marks.cookie || marks.storage) throw new Error(`private window read regular data ${JSON.stringify(marks)}`);
      await writeMarks(page.session, `private-${run}`);
      const regular = await readMarks(defaultPage.session);
      if (regular.cookie !== `default-${run}`) throw new Error(`private write reached the regular profile ${JSON.stringify(regular)}`);
      privateWindow = { ...opened, page };
      return { windowId: opened.windowId, pageProfile: opened.shell.pageProfile, privateBootstrap: opened.shell.privateWindow, context: page.browserContextId };
    });
    await t.check("the saved session never holds private state", async () => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const saved = await readSavedSession(state.scratch);
      const leaks = privateLeaks(saved);
      if (leaks.length) throw new Error(`private state persisted: ${leaks.join(", ")}`);
      return { windows: Object.keys(saved?.windows ?? {}) };
    });
    await t.check("private data is gone after the last private window closes", async () => {
      await privateWindow.shell.state("s.closeWindow(windowId); return true;");
      await until(async () => !(await state.shell.windowIds()).includes(privateWindow.windowId), { timeout: 15000, label: "private native window to close" });
      await until(async () => !(await state.app.browserTargets()).some((t) => t.browserContextId === privateWindow.page.browserContextId), { timeout: 15000, label: "private browser context to empty" });
      const opened = await openProfileWindow(state.app, state.shell, `return s.createWindow({ kind: "private", profileId: "default" });`, "second private window");
      const page = await profilePage(state.app, opened.shell, t.fixtures.url.isolation("isolation.ardia.test") + `?p=private-again-${run}`);
      const marks = await readMarks(page.session);
      await opened.shell.state("s.closeWindow(windowId); return true;").catch(() => {});
      if (marks.cookie || marks.storage) throw new Error(`private data survived ${JSON.stringify(marks)}`);
      return marks;
    });
    await t.check("failed profile creation leaves no phantom window", async () => {
      await chmod(state.scratch, 0o555);
      try {
        const profileId = await state.shell.state(`return s.createProfile({ name: ${js(`Blocked ${run}`)} });`);
        const windowId = await state.shell.state(`return s.createWindow({ profileId: ${js(profileId)} });`);
        await until(async () => !(await state.shell.state(`return !!s.windows[${js(windowId)}];`)), { timeout: 20000, label: "the failed window to leave the store" });
        if ((await state.shell.windowIds()).includes(windowId)) throw new Error("a native window exists for the failed profile");
        return { profileId, windowId };
      } finally {
        await chmod(state.scratch, 0o755);
      }
    });

    await t.check("after restart no private window returns and profiles keep their data", async () => {
      await waitSavedSession(state.scratch, (s) => privateLeaks(s).length === 0, { timeout: 10000 });
      state = await restartBrowser(t, state);
      const windows = await state.shell.state("return Object.values(s.windows).map(w => ({ id: w.id, incognito: w.kind === 'private', profileId: w.profileId }));");
      if (windows.some((w) => w.incognito || /^incognito:/.test(w.profileId))) throw new Error(`private window restored ${JSON.stringify(windows)}`);
      const page = await profilePage(state.app, state.shell, t.fixtures.url.isolation("isolation.ardia.test") + `?p=after-restart-${run}`);
      const marks = await readMarks(page.session);
      if (marks.cookie !== `default-${run}`) throw new Error(`default cookie lost across restart ${JSON.stringify(marks)}`);
      return { windows, marks };
    });
  },
};
