import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { evaluate } from "../lib/cdp.mjs";
import { restartBrowser, startBrowser } from "../lib/flows.mjs";
import { LIVE_FIXTURE, liveSecretValues } from "../lib/liveServices.mjs";
import { js, nonce, until } from "../lib/util.mjs";

export const TOKEN_DIRECTORY = "Ardia Live Tokens";
export const TOKEN_FILES = ["live-token-bitbucket", "live-token-confluence", "live-token-gdrive", "live-token-github", "live-token-notion"];

const live = (shell, body, timeout = 60000) => shell.eval(`(async () => { const L = ardiaLinux.live; const S = L.store.getState(); ${body} })()`, { timeout });
const accounts = (shell) => live(shell, "return Object.fromEntries(Object.entries(S.accounts).map(([k, v]) => [k, v?.login ?? null]));");
const titles = (shell, folderId) => live(shell, `return (S.items[${js(folderId)}] ?? []).map((it) => it.title);`);
const status = (shell, folderId) => live(shell, `return L.statusText(${js(folderId)});`);

async function waitStatus(shell, folderId, test, label) {
  return until(async () => {
    const text = await status(shell, folderId);
    return test(text) ? text : false;
  }, { timeout: 30000, interval: 250, label, abort: () => shell.app.exitReason() });
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

export async function plaintextTokens(dir, secrets = liveSecretValues()) {
  const leaks = [];
  for (const path of await walk(dir)) {
    const info = await stat(path).catch(() => null);
    if (!info || info.size > 64 << 20) continue;
    const bytes = await readFile(path).catch(() => null);
    if (!bytes) continue;
    for (const secret of secrets) if (bytes.includes(secret)) leaks.push(`${secret.slice(0, 6)}… in ${path.slice(dir.length)}`);
  }
  return leaks;
}

const searchRequests = (fixtures) => fixtures.live.requests("api.github.com").filter((r) => r.body.includes("query LiveFolder("));

export default {
  id: "F11",
  issue: 21,
  title: "Live folders connect, refresh, restart and disconnect every provider through the native service",
  deadline: 420000,
  manual: [
    { name: "Real provider accounts", steps: ["Connect GitHub (token and Sign In with GitHub…), Bitbucket, Notion, Confluence and Google Drive with real accounts in Settings › Live Folders.", "Each Live folder lists the account's pull requests or recent documents; refresh, restart and disconnect behave as in the fixture run."], reason: "needs real provider credentials and OAuth client IDs" },
    { name: "Tokens live in the desktop keyring", steps: ["Run Ardia normally (not ARDIA_BACKGROUND) with GNOME Keyring or KWallet's Secret Service.", "Connect a service: Seahorse (or KWalletManager) shows an \"Ardia Live Folder Token\" item whose account is the service name; nothing is written under the profile folder.", "Lock the keyring and refresh: the folder says to unlock the keyring; unlocking and refreshing recovers."], reason: "automated in F11K with a private gnome-keyring and its real unlock prompt (a dismissed prompt fails, #256); KWallet needs a person" },
  ],
  async run(t) {
    const run = nonce("f11");
    const { fixtures } = t;
    let state = await startBrowser(t, { name: "live" });
    let { shell } = state;
    const tokenDir = () => join(state.scratch, TOKEN_DIRECTORY);
    const folders = {};

    await t.check("the browser advertises the native Live service and the shell exposes Live", async () => {
      const methods = await shell.eval("__ardiaHost.bootstrap.capabilities.filter((c) => c.startsWith('ArdiaLive.')).sort()");
      if (methods.join() !== "ArdiaLive.cancel,ArdiaLive.connect,ArdiaLive.disconnect,ArdiaLive.request") throw new Error(`advertised ${methods.join()}`);
      if (!(await shell.eval("typeof ardiaLinux.live?.connectGithub === 'function'"))) throw new Error("ardiaLinux.live is missing");
      return methods;
    }, { critical: true });

    await t.check("an ordinary page cannot reach the shell bridge or the Live service", async () => {
      const url = fixtures.url.page(1, run);
      const tabId = await shell.newTab(url);
      await shell.waitTabUrl(tabId, (current) => current === url);
      const target = await shell.app.pageLoaded(url);
      const session = await shell.app.connect(target);
      const leaked = await evaluate(session, "['__ardiaHost', 'ardiaLinux', '__ardiaPage'].filter((name) => typeof globalThis[name] !== 'undefined').concat(typeof globalThis.chrome?.send === 'function' ? ['chrome.send'] : [])");
      await shell.app.disconnect(target);
      if (leaked.length) throw new Error(`the page sees ${leaked.join(", ")}`);
      return true;
    });

    await t.check("each advertised provider connects, and its token is kept only in the protected store", async () => {
      const f = LIVE_FIXTURE;
      await live(shell, `await L.connectGithub(${js(f.github.token)}); await L.connectBitbucket(${js(f.bitbucket.user)}, ${js(f.bitbucket.token)}); await L.connectNotion(${js(f.notion.token)}); await L.connectConfluence("acme.atlassian.net", ${js(f.confluence.email)}, ${js(f.confluence.token)}); return true;`);
      await live(shell, `await L.connectGoogleDrive(${js(shell.windowId)}, ${js(f.gdrive.clientId)}, ${js(f.gdrive.clientSecret)}); return true;`, 90000);
      const connected = await accounts(shell);
      const want = { github: f.github.login, bitbucket: f.bitbucket.accountId, notion: f.notion.workspace, confluence: f.confluence.accountId, gdrive: f.gdrive.email };
      for (const [source, login] of Object.entries(want)) if (connected[source] !== login) throw new Error(`${source} is ${connected[source]}`);
      const files = (await readdir(tokenDir())).sort();
      if (files.join() !== TOKEN_FILES.join()) throw new Error(`token store holds ${files.join()}`);
      for (const name of files) if (((await stat(join(tokenDir(), name))).mode & 0o777) !== 0o600) throw new Error(`${name} is not private`);
      const shellState = await live(shell, "return JSON.stringify(S);");
      for (const secret of liveSecretValues()) if (shellState.includes(secret)) throw new Error("a token reached the renderer's Live state");
      return connected;
    });

    await t.check("pull request and document folders refresh fixture data from every provider", async () => {
      folders.prs = await live(shell, `return L.newFolder("default", "pullRequests", ["github", "bitbucket"]);`);
      folders.docs = await live(shell, `return L.newFolder("default", "documents", ["notion", "confluence", "gdrive"]);`);
      const want = { prs: ["Fixture pull request one", "Fixture pull request two", "Fixture Bitbucket change"], docs: ["Fixture Notion page", "Fixture Confluence page", "Fixture Drive doc"] };
      for (const [key, expected] of Object.entries(want)) {
        await until(async () => (await titles(shell, folders[key])).length === expected.length, { timeout: 30000, interval: 250, label: `${key} folder items` });
        const got = (await titles(shell, folders[key])).sort();
        if (got.join("|") !== [...expected].sort().join("|")) throw new Error(`${key} lists ${got.join(", ")}`);
      }
      await until(async () => (await shell.text()).includes("Fixture pull request one"), { timeout: 10000, label: "the sidebar to show a fixture pull request" });
      return folders;
    });

    await t.check("each token reaches only its own provider host and no request carries cookies", async () => {
      const owners = { "api.github.com": LIVE_FIXTURE.github.token, "api.bitbucket.org": LIVE_FIXTURE.bitbucket.token, "api.notion.com": LIVE_FIXTURE.notion.token, "acme.atlassian.net": LIVE_FIXTURE.confluence.token };
      const requests = fixtures.live.requests();
      for (const request of requests) {
        if (request.headers.cookie) throw new Error(`${request.host} received cookies`);
        const auth = request.headers.authorization ?? "";
        const seen = JSON.stringify(request.headers) + request.body + (auth.startsWith("Basic ") ? Buffer.from(auth.slice(6), "base64").toString() : "");
        for (const [host, token] of Object.entries(owners)) if (host !== request.host && seen.includes(token)) throw new Error(`${host}'s token reached ${request.host}`);
      }
      return { requests: requests.length };
    });

    await t.check("two browser windows refresh a shared folder once, not twice", async () => {
      const windowId = await shell.state(`return s.createWindow({ profileId: "default" });`);
      const other = await shell.app.shell(windowId, { timeout: 25000 });
      await other.waitFor("typeof ardiaLinux.live?.refresh === 'function'");
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const before = searchRequests(fixtures).length;
      await Promise.all([live(shell, `await L.refresh(${js(folders.prs)}); return true;`), live(other, `await L.refresh(${js(folders.prs)}); return true;`)]);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const made = searchRequests(fixtures).length - before;
      await shell.state(`s.closeWindow(${js(windowId)}); return true;`);
      if (made !== 1) throw new Error(`the folder was fetched ${made} times`);
      return { fetches: made };
    });

    await t.check("a private window cannot use the Live service", async () => {
      const windowId = await shell.state(`return s.createWindow({ kind: "private", profileId: "default" });`);
      const privateShell = await shell.app.shell(windowId, { timeout: 25000 });
      const reply = await privateShell.invoke("ArdiaLive.request", { args: ["github", "graphql", { query: "query { viewer { login } }" }, "private1"] });
      const connect = await privateShell.invoke("ArdiaLive.connect", { args: ["notion", { token: LIVE_FIXTURE.notion.token }, "private2"] });
      await shell.state(`s.closeWindow(${js(windowId)}); return true;`);
      if (reply.ok || reply.code !== "ERR_PRIVATE_SERVICE") throw new Error(`request answered ${JSON.stringify(reply)}`);
      if (connect.ok || connect.code !== "ERR_PRIVATE_SERVICE") throw new Error(`connect answered ${JSON.stringify(connect)}`);
      return true;
    });

    await t.check("a revoked token asks to sign back in and keeps the account", async () => {
      fixtures.live.revokeGithub();
      await live(shell, `await L.refresh(${js(folders.prs)}); return true;`);
      const text = await waitStatus(shell, folders.prs, (s) => s.includes("Sign back in to GitHub"), "the sign-in prompt");
      fixtures.live.state.githubTokens.add(LIVE_FIXTURE.github.token);
      if (!(await accounts(shell)).github) throw new Error("the account was dropped");
      return text;
    });

    await t.check("offline refreshes say they couldn't connect, keep the rows, and the next refresh recovers", async () => {
      fixtures.live.state.offline = true;
      await live(shell, `await L.refresh(${js(folders.docs)}); return true;`);
      const offline = await waitStatus(shell, folders.docs, (s) => s.startsWith("Couldn't connect to"), "the offline status");
      const kept = (await titles(shell, folders.docs)).length;
      fixtures.live.state.offline = false;
      await live(shell, `await L.refresh(${js(folders.docs)}); return true;`);
      const online = await waitStatus(shell, folders.docs, (s) => s.startsWith("Updated"), "the recovered status");
      if (kept !== 3) throw new Error(`offline refresh left ${kept} rows`);
      return { offline, online };
    });

    await t.check("Google access renews natively once it expires", async () => {
      const renewals = fixtures.live.state.googleRenewals;
      fixtures.live.expireGoogleAccess();
      await live(shell, `await L.refresh(${js(folders.docs)}); return true;`);
      await waitStatus(shell, folders.docs, (s) => s.startsWith("Updated"), "the renewed refresh");
      if (fixtures.live.state.googleRenewals !== renewals + 1) throw new Error(`renewed ${fixtures.live.state.googleRenewals - renewals} times`);
      return true;
    });

    await t.check("a restart keeps every connection and refreshes without signing in again", async () => {
      state = await restartBrowser(t, state);
      shell = state.shell;
      await shell.waitFor("typeof ardiaLinux.live?.refresh === 'function'", { timeout: 20000 });
      const before = fixtures.live.requests().length;
      const connected = await accounts(shell);
      if (Object.values(connected).filter(Boolean).length !== 5) throw new Error(`after restart: ${JSON.stringify(connected)}`);
      await live(shell, `await L.refresh(${js(folders.prs)}); await L.refresh(${js(folders.docs)}); return true;`);
      await waitStatus(shell, folders.prs, (s) => s.startsWith("Updated"), "the pull request folder after restart");
      await waitStatus(shell, folders.docs, (s) => s.startsWith("Updated"), "the document folder after restart");
      return { requests: fixtures.live.requests().length - before };
    });

    await t.check("disconnecting each provider deletes its protected token and the folder asks to connect", async () => {
      await live(shell, `for (const source of ["github", "bitbucket", "notion", "confluence", "gdrive"]) await L.disconnect(source); return true;`);
      const left = await readdir(tokenDir()).catch(() => []);
      if (left.length) throw new Error(`tokens left: ${left.join(", ")}`);
      await live(shell, `await L.refresh(${js(folders.prs)}); return true;`);
      const text = await waitStatus(shell, folders.prs, (s) => s.startsWith("Connect "), "the connect prompt");
      return text;
    });

    await t.check("no token was written in plain text anywhere in the profile", async () => {
      const leaks = await plaintextTokens(state.scratch);
      if (leaks.length) throw new Error(leaks.join("; "));
      return true;
    });
  },
};
