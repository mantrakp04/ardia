import { join } from "node:path";
import { startBrowser } from "../lib/flows.mjs";
import { digestTree, leftoverImportCopies, savedLogins, writeImportFixtures } from "../lib/importFixtures.mjs";
import { sessionSeed, writeProfileSeed } from "../lib/seed.mjs";
import { js, nonce, until } from "../lib/util.mjs";

const JOB_TIMEOUT = 45000;

function runJob(shell, args, options) {
  return runRequest(shell, "ArdiaImport.startImport", args, options);
}

let writes = 0;
function writeToken(shell, token, profile) {
  return runRequest(shell, "ArdiaImport.writePasswords", [`write-${++writes}`, token, profile]);
}

export function runRequest(shell, method, args, { cancelOnHistoryProgress = false } = {}) {
  return shell.eval(`new Promise((resolve) => {
    const jobId = ${js(args[0])};
    const progress = [];
    let cancelled = false;
    let timer;
    const stop = __ardiaHost.onEvent((module, event, payload) => {
      if (module !== "ArdiaImport" || event !== "onImportEvent" || payload?.jobId !== jobId) return;
      if (payload.type === "progress") {
        progress.push({ kind: payload.kind, phase: payload.phase, processed: payload.processed });
        if (${js(cancelOnHistoryProgress)} && !cancelled && payload.kind === "history" && payload.phase === "progress") {
          cancelled = true;
          __ardiaHost.invoke("ArdiaImport.cancelImport", { args: [jobId] });
        }
        return;
      }
      stop();
      clearTimeout(timer);
      resolve({ ...payload, progress, cancelled });
    });
    timer = setTimeout(() => { stop(); resolve({ type: "timeout", progress }); }, ${JOB_TIMEOUT});
    __ardiaHost.invoke(${js(method)}, { args: ${js(args)} }).catch((error) => {
      stop();
      clearTimeout(timer);
      resolve({ type: "rejected", code: error?.code ?? null, message: String(error?.message ?? error) });
    });
  })`, { timeout: JOB_TIMEOUT + 5000 });
}

function countLinks(node) {
  if (!node) return 0;
  if (node.type === "url") return 1;
  return (node.children ?? []).reduce((sum, child) => sum + countLinks(child), 0);
}

async function invokeOk(shell, method, args) {
  const reply = await shell.invoke(method, { args });
  if (!reply.ok) throw new Error(`${method} failed: ${reply.code} ${reply.message}`);
  return reply.value;
}

export default {
  id: "F12",
  issue: 22,
  title: "Browser discovery and import of bookmarks, history and passwords from scratch profiles",
  deadline: 360000,
  manual: [
    { name: "Import window click-through", steps: ["Open File › Import from Another Browser in a profile whose HOME holds a Chrome and a Firefox profile.", "Chrome is selected with Bookmarks, History and Passwords; Continue imports them; the Done step shows the same counts as the source.", "Settings › Passwords lists the imported Chrome passwords after unlocking.", "Choosing Firefox offers Bookmarks and History only."], reason: "automated in F12W with fixture profiles; real profiles need a person" },
    { name: "Chromium's SQLite build reads real profiles", steps: ["Import from a current Chrome and Firefox profile copied from a real machine into a scratch HOME.", "History and bookmarks import with the source's counts: Chromium's SQLite build omits UPSERT, window functions and JSON, and the readers' queries must not need them on real schemas."], reason: "fixtures use the system SQLite; only a real build exercises Chromium's" },
    { name: "Keyring-protected Chrome passwords", steps: ["Import from a Chrome profile that uses the GNOME keyring or KWallet (v11).", "Ardia asks to unlock the browser's Safe Storage key; allowing it imports the keyring-protected passwords, and skipping notes that they weren't imported."], reason: "automated in F12W and I109K with a private gnome-keyring; KWallet needs a person" },
  ],
  async run(t) {
    const run = nonce("f12");
    const scratch = await t.scratch("import");
    const home = join(scratch, "home");
    const tmp = await t.tempDir("import");
    await writeProfileSeed(scratch, { session: sessionSeed() });
    const fixtures = await writeImportFixtures(home);
    const sources = await digestTree(home);
    const { shell } = await startBrowser(t, { name: "import", scratch, env: { TMPDIR: tmp } });

    let browsers;
    await t.check("discovery lists the scratch Chrome and Firefox profiles", async () => {
      browsers = await invokeOk(shell, "ArdiaImport.listBrowsers", []);
      const chrome = browsers.find((b) => b.id === "chrome");
      const firefox = browsers.find((b) => b.id === "firefox");
      if (!chrome || !firefox) throw new Error(`sources ${JSON.stringify(browsers.map((b) => b.id))}`);
      const personal = chrome.profiles.find((p) => p.id === "Default");
      if (personal?.name !== "Scratch Personal" || !personal.isDefault || personal.available.join() !== "bookmarks,history,passwords") throw new Error(`chrome profile ${JSON.stringify(personal)}`);
      if (firefox.profiles[0]?.available.join() !== "bookmarks,history") throw new Error(`firefox profile ${JSON.stringify(firefox.profiles)}`);
      return browsers.map((b) => ({ id: b.id, profiles: b.profiles.map((p) => [p.id, p.available]) }));
    }, { critical: true });

    let token;
    await t.check("a Chrome profile import returns accurate counts and a password token without plaintext", async () => {
      const reply = await runJob(shell, [`${run}-chrome`, "chrome", "Default", ["bookmarks", "history", "passwords"], {}]);
      if (reply.type !== "done") throw new Error(`import ended ${JSON.stringify(reply)}`);
      const result = reply.result;
      const text = JSON.stringify(reply);
      const leaked = fixtures.secrets.filter((secret) => text.includes(secret));
      if (leaked.length) throw new Error(`plaintext passwords in the renderer reply: ${leaked.length}`);
      const counts = { links: countLinks(result.bookmarks), history: result.history.length, passwords: result.passwords?.count, failed: result.failed, credentials: result.credentials.length };
      const want = { links: fixtures.expected.chromeLinks, history: fixtures.expected.chromeHistory, passwords: fixtures.expected.chromePasswords, failed: [], credentials: 0 };
      if (JSON.stringify(counts) !== JSON.stringify(want)) throw new Error(`counts ${JSON.stringify(counts)} want ${JSON.stringify(want)}`);
      if (!result.warnings.some((w) => w.code === "locked" && /keyring/.test(w.message))) throw new Error(`no keyring note in ${JSON.stringify(result.warnings)}`);
      token = result.passwords.token;
      return { counts, warnings: result.warnings, progress: reply.progress };
    }, { critical: true });

    await t.check("imported passwords land in Chromium's own store once, and the token is single use", async () => {
      const first = await writeToken(shell, token, "");
      if (first.type !== "written" || first.added !== fixtures.expected.chromePasswords || first.existing !== 0) throw new Error(`first write ${JSON.stringify(first)}`);
      const reused = await writeToken(shell, token, "");
      if (reused.type !== "rejected" || reused.code !== "expired") throw new Error(`reused token ${JSON.stringify(reused)}`);
      const again = await runJob(shell, [`${run}-chrome-again`, "chrome", "Default", ["passwords"], {}]);
      const second = await writeToken(shell, again.result.passwords.token, "");
      if (second.type !== "written" || second.added !== 0 || second.existing !== fixtures.expected.chromePasswords) throw new Error(`duplicate write ${JSON.stringify(second)}`);
      const stored = await until(async () => {
        const rows = await savedLogins(join(scratch, "Default", "Login Data"), tmp);
        return rows.length >= fixtures.expected.chromePasswords ? rows : false;
      }, { timeout: 20000, label: "Ardia's Login Data to hold the imported passwords" });
      const imported = stored.filter((row) => row.origin.includes(".ardia.test"));
      if (imported.length !== fixtures.expected.chromePasswords) throw new Error(`stored ${imported.length} rows after a duplicate import`);
      const matches = fixtures.secrets.slice(0, 3).every((secret) => imported.some((row) => row.password === secret));
      if (!matches) throw new Error("stored passwords don't match the source");
      const bogus = await writeToken(shell, "0".repeat(32), "work");
      if (bogus.code !== "expired") throw new Error(`an unknown token resolved a profile: ${JSON.stringify(bogus)}`);
      return { first, second, stored: imported.length };
    });

    await t.check("passwords go into the chosen isolated profile and never into a private one", async () => {
      const privateRun = await runJob(shell, [`${run}-private`, "chrome", "Default", ["passwords"], {}]);
      const refused = await writeToken(shell, privateRun.result.passwords.token, "incognito:w1@");
      const invalid = await writeToken(shell, privateRun.result.passwords.token, "../escape");
      if (refused.code !== "ERR_PROFILE_PRIVATE" || invalid.code !== "ERR_PROFILE_INVALID") throw new Error(`profile errors ${JSON.stringify({ refused, invalid })}`);
      const discarded = await writeToken(shell, privateRun.result.passwords.token, "");
      if (discarded.code !== "expired") throw new Error(`a refused token stayed usable: ${JSON.stringify(discarded)}`);
      const isolatedRun = await runJob(shell, [`${run}-isolated`, "chrome", "Default", ["passwords"], {}]);
      const written = await writeToken(shell, isolatedRun.result.passwords.token, "work");
      const rows = await until(async () => {
        const found = (await savedLogins(join(scratch, "Profile work", "Login Data"), tmp)).filter((row) => row.origin.includes(".ardia.test"));
        return found.length >= fixtures.expected.chromePasswords ? found : false;
      }, { timeout: 20000, label: "the isolated profile's Login Data to hold the imported passwords" });
      const defaults = (await savedLogins(join(scratch, "Default", "Login Data"), tmp)).filter((row) => row.origin.includes(".ardia.test"));
      if (written.added !== fixtures.expected.chromePasswords || rows.length !== fixtures.expected.chromePasswords || defaults.length !== fixtures.expected.chromePasswords) {
        throw new Error(`isolated ${rows.length}, default ${defaults.length}, written ${JSON.stringify(written)}`);
      }
      return { written, isolated: rows.length, default: defaults.length };
    });

    await t.check("partial errors keep the readable kinds", async () => {
      const reply = await runJob(shell, [`${run}-partial`, "chrome", "Profile 1", ["bookmarks", "history"], {}]);
      if (reply.type !== "done" || countLinks(reply.result.bookmarks) !== 1 || reply.result.failed.join() !== "history") throw new Error(`partial ${JSON.stringify(reply)}`);
      return { failed: reply.result.failed, warnings: reply.result.warnings };
    });

    await t.check("cancelling a large import stops it and removes its temporary copies", async () => {
      const reply = await runJob(shell, [`${run}-large`, "chrome", "Profile 2", ["history"], {}], { cancelOnHistoryProgress: true });
      if (reply.type !== "failed" || reply.code !== "cancelled" || !reply.cancelled) throw new Error(`cancel ${JSON.stringify({ ...reply, progress: reply.progress?.length })}`);
      const left = await until(async () => ((await leftoverImportCopies(tmp)).length === 0 ? "clean" : false), { timeout: 10000, label: "temporary import copies to be removed" });
      return { progressEvents: reply.progress.length, left };
    });

    await t.check("a Firefox profile imports bookmarks and history and reports that it has no saved logins", async () => {
      const firefox = browsers.find((b) => b.id === "firefox").profiles[0].id;
      const reply = await runJob(shell, [`${run}-firefox`, "firefox", firefox, ["bookmarks", "history", "passwords"], {}]);
      if (reply.type !== "done") throw new Error(`firefox ${JSON.stringify(reply)}`);
      const counts = { links: countLinks(reply.result.bookmarks), history: reply.result.history.length, failed: reply.result.failed };
      if (counts.links !== fixtures.expected.firefoxLinks || counts.history !== fixtures.expected.firefoxHistory || counts.failed.length || !reply.result.warnings.some((w) => w.kind === "passwords" && w.code === "empty")) throw new Error(`counts ${JSON.stringify(counts)}`);
      return counts;
    });

    await t.check("files are read only after the native chooser picks them", async () => {
      const html = await shell.invoke("ArdiaImport.importBookmarksHTML", { args: [fixtures.html] });
      const csv = await shell.invoke("ArdiaImport.importPasswordsCSV", { args: [fixtures.csv] });
      if (html.code !== "ERR_FILE_NOT_CHOSEN" || csv.code !== "ERR_FILE_NOT_CHOSEN") throw new Error(`unchosen reads ${JSON.stringify({ html, csv })}`);
      const chooser = await shell.eval(`new Promise((resolve) => {
        const stop = __ardiaHost.onEvent((module, event, payload) => {
          if (module === "ArdiaImport" && payload?.jobId === "${run}-choose") { stop(); resolve({ ok: true, event: payload }); }
        });
        setTimeout(() => { stop(); resolve({ ok: true, event: "no event" }); }, 8000);
        __ardiaHost.invoke("ArdiaImport.chooseImportFile", { args: ["${run}-choose", "bookmarksHTML"] }).catch((error) => { stop(); resolve({ ok: false, code: error?.code }); });
      })`, { timeout: 15000 });
      const explicit = chooser.ok ? chooser.event?.type === "chosen" && chooser.event.path === null : chooser.code === "ERR_FILE_CHOOSER_DISABLED";
      if (!explicit) throw new Error(`a headless chooser must cancel or report unavailable, got ${JSON.stringify(chooser)}`);
      return { html: html.code, csv: csv.code, chooser };
    });

    await t.check("source profiles are byte-for-byte unchanged and no temporary copies remain", async () => {
      const after = await digestTree(home);
      const changed = Object.keys(sources).filter((path) => after[path] !== sources[path]);
      if (changed.length) throw new Error(`changed ${changed.join(", ")}`);
      const left = await leftoverImportCopies(tmp);
      if (left.length) throw new Error(`left ${left.join(", ")}`);
      return { files: Object.keys(sources).length };
    });
    await t.screenshot(shell, "after-import");
  },
};
