import { SUGGEST_HOST, suggestionsFor } from "../lib/fixtures.mjs";
import { startBrowser } from "../lib/flows.mjs";
import { sessionSeed } from "../lib/seed.mjs";
import { js, nonce, until } from "../lib/util.mjs";

async function onPage(shell, url) {
  const tabId = await shell.newTab(url);
  await shell.waitTabUrl(tabId, (current) => current === url);
  await shell.app.pageLoaded(url);
}

async function typeQuery(shell, query) {
  await shell.state("s.openPanel(windowId, ''); return true;");
  await shell.waitFor("document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA'", { timeout: 6000, label: "command bar focus" });
  await shell.insertText(query);
}

async function closePanel(shell) {
  await shell.state("s.closePanel(windowId); return true;");
}

const requestsFor = (fixtures, query) => fixtures.suggestRequests().filter((r) => (r.query.q ?? "").includes(query));

export default {
  id: "F10",
  issue: 20,
  title: "Online search suggestions through the native host, only when enabled",
  deadline: 240000,
  manual: [],
  async run(t) {
    const run = nonce("f10");
    const { app, shell } = await startBrowser(t, { name: "suggestions", session: sessionSeed({ settings: { searchSuggestions: true } }) });
    await t.check("a suggestion-host cookie exists that must never be sent", async () => {
      await app.browser.send("Storage.setCookies", { cookies: [{ name: "SID", value: `secret-${run}`, domain: SUGGEST_HOST, path: "/", secure: true, httpOnly: true }] });
      return true;
    });
    const enabled = `ardia enabled ${run}`;
    await t.check("enabled suggestions arrive from the controlled endpoint", async () => {
      await onPage(shell, t.fixtures.url.page(1, run));
      await typeQuery(shell, enabled);
      const want = suggestionsFor(enabled)[0];
      await until(async () => (await shell.text()).includes(want), { timeout: 15000, label: `suggestion "${want}" in the command bar` });
      const requests = requestsFor(t.fixtures, enabled);
      if (!requests.length) throw new Error("no request reached the fixture endpoint");
      return { requests: requests.length, path: requests[0].path };
    });
    await t.check("suggestion requests carry no cookies or credentials", async () => {
      const requests = requestsFor(t.fixtures, enabled);
      const leaking = requests.filter((r) => r.headers.cookie || r.headers.authorization);
      if (leaking.length) throw new Error(`sent ${JSON.stringify(leaking.map((r) => ({ cookie: r.headers.cookie, authorization: r.headers.authorization })))}`);
      const origins = [...new Set(requests.map((r) => r.headers.origin ?? null))];
      return { requests: requests.length, origins };
    });
    await closePanel(shell);
    const disabled = `ardia disabled ${run}`;
    await t.check("disabled suggestions send zero requests", async () => {
      await shell.state("s.updateSettings({ searchSuggestions: false }); return true;");
      await shell.waitState("return s.settings.searchSuggestions === false;", { timeout: 5000 });
      const before = t.fixtures.suggestRequests().length;
      await typeQuery(shell, disabled);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const after = t.fixtures.suggestRequests().length;
      const text = await shell.text();
      await closePanel(shell);
      if (after !== before) throw new Error(`${after - before} suggestion requests while disabled`);
      if (text.includes(suggestionsFor(disabled)[0])) throw new Error("a remote suggestion rendered while disabled");
      return { requests: 0 };
    });
    await t.check("a private window gets suggestions without cookies", async () => {
      await shell.state("s.updateSettings({ searchSuggestions: true }); return true;");
      const windowId = await shell.state(`return s.createWindow({ kind: "private", profileId: "default" });`);
      const privateShell = await app.shell(windowId, { timeout: 25000 });
      await onPage(privateShell, t.fixtures.url.page(2, run));
      const query = `ardia private ${run}`;
      await typeQuery(privateShell, query);
      const want = suggestionsFor(query)[0];
      await until(async () => (await privateShell.text()).includes(want), { timeout: 15000, label: "private window suggestion" });
      const requests = requestsFor(t.fixtures, query);
      await closePanel(privateShell);
      await shell.state(`s.closeWindow(${js(windowId)}); return true;`);
      if (requests.some((r) => r.headers.cookie)) throw new Error("a private window's suggestion request sent cookies");
      return { requests: requests.length };
    });
  },
};
