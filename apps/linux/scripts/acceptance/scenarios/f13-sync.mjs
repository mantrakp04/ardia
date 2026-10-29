import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { phraseWords, wordlistFrom } from "../../../../../engine/ardiacore-linux/tests/sync_reference.mjs";
import { restartBrowser, startBrowser } from "../lib/flows.mjs";
import { sessionSeed } from "../lib/seed.mjs";
import { js, nonce, until } from "../lib/util.mjs";

const WORDLIST = fileURLToPath(new URL("../../../../../packages/sync/ios/Core/Wordlist.swift", import.meta.url));
const KEY_DIRECTORY = "Ardia Sync Keys";

export async function walkFolder(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const paths = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    paths.push(path);
    if (entry.isDirectory()) paths.push(...(await walkFolder(path)));
  }
  return paths;
}

export async function folderLeaks(dir, secrets) {
  const leaks = [];
  for (const path of await walkFolder(dir)) {
    const relative = path.slice(dir.length);
    for (const secret of secrets) if (relative.includes(secret)) leaks.push(`${secret} in the name ${relative}`);
    const info = await stat(path);
    if (!info.isFile()) continue;
    const bytes = await readFile(path);
    for (const secret of secrets) if (bytes.includes(secret)) leaks.push(`${secret} in ${relative}`);
    if (!relative.endsWith(".nns") || !bytes.subarray(0, 4).equals(Buffer.from("NNS1")) || (bytes.length - 32) % 1024) leaks.push(`unexpected file ${relative}`);
  }
  return leaks;
}

export async function phraseFromKeyStore(scratch, deviceId) {
  const entropy = await readFile(join(scratch, KEY_DIRECTORY, `sync-key-${deviceId}`));
  if (entropy.length !== 32) throw new Error(`the test key store holds ${entropy.length} bytes`);
  return phraseWords(entropy, wordlistFrom(WORDLIST)).join(" ");
}

const syncState = (shell) => shell.eval("ardiaLinux.sync.state()");
const syncRole = (shell) => shell.eval("ardiaLinux.sync.role()");
const syncCall = (shell, method, ...args) => shell.eval(`ardiaLinux.sync[${js(method)}](...${js(args)})`, { timeout: 60000 });

async function deviceIdOf(scratch) {
  const names = (await readdir(join(scratch, KEY_DIRECTORY)).catch(() => [])).filter((name) => name.startsWith("sync-key-") && !name.endsWith(".staging"));
  if (names.length !== 1) throw new Error(`expected one sync key, found ${names.length}`);
  return names[0].slice("sync-key-".length);
}

async function addBookmark(shell, url, title) {
  return shell.state(`return s.addBookmark({ profileId: s.windows[windowId].profileId, url: ${js(url)}, title: ${js(title)} });`);
}

const hasBookmark = (shell, title) => shell.state(`return Object.values(s.bookmarks.nodes).some((n) => n.title === ${js(title)});`);

async function syncedUntil(shells, test, label) {
  return until(async () => {
    for (const shell of shells) await syncCall(shell, "syncNow").catch(() => null);
    return test();
  }, { timeout: 90000, interval: 2000, label });
}

export default {
  id: "F13",
  issue: 23,
  title: "Encrypted folder sync between two scratch profiles through a temporary folder",
  deadline: 420000,
  manual: [
    { name: "The sync key lives in the desktop keyring", steps: ["Run Ardia normally (not ARDIA_BACKGROUND) in a session with GNOME Keyring or KWallet's Secret Service.", "Settings › Sync › Turn On Sync: Seahorse (or KWalletManager) shows an \"Ardia Sync Key\" item whose account is the device id; nothing is written under the profile folder.", "Restart Ardia: sync resumes without asking for the phrase."], reason: "automated in F13K with a private gnome-keyring; KWallet needs a person" },
    { name: "No or locked keyring fails safely", steps: ["Stop the Secret Service (or lock the keyring and dismiss the unlock prompt) and turn on sync: the pane says the keyring isn't running or is locked; nothing is written to the folder.", "With sync on, lock the keyring and restart: Sync shows \"not syncing\" with the keyring message and Enter Recovery Phrase…; entering the phrase resumes."], reason: "automated in F13K with its real unlock prompt; a dismissed prompt at launch fails there (#261)" },
    { name: "The recovery phrase needs system authentication", steps: ["Install the polkit policy (see F07) and run a polkit agent.", "Settings › Sync › Connect Another Device…: Show Words, Show Code (QR) and Copy Words each prompt once, then work for 60 s without prompting; Stop Syncing ends that early.", "Advanced… › Save Recovery Kit… › Save as Text: the save dialog appears, then the agent prompts; the file is mode 0600 and lists the 24 words.", "Deny or dismiss the prompt: nothing is shown, copied or written."], reason: "automated in F13K against a mocked polkit authority except Stop Syncing ending the 60 s early; a real agent's dialog needs a person" },
    { name: "Linux and macOS share one folder", steps: ["Put the sync folder in Syncthing, Dropbox or a NAS share that a Mac on the current release also uses.", "Turn on sync on the Mac, enter its phrase on Linux (and the reverse): bookmarks, history, settings and pinned tabs go both ways; a file still syncing shows as \"waiting for N files\" and applies once whole.", "Passwords stay on each device on Linux for now (#145)."], reason: "needs a Mac and a real folder-sync service" },
  ],
  async run(t) {
    const run = nonce("f13");
    const shared = join(await t.scratch("shared"), "Ardia Sync");
    await mkdir(shared, { recursive: true });
    const extraArgs = [`--ardia-sync-folder=${shared}`];
    const session = sessionSeed({ windows: [{ id: "main", urls: [t.fixtures.url.page(1, "sync-main")] }, { id: "second", urls: [t.fixtures.url.page(2, "sync-second")] }] });
    let a = await startBrowser(t, { name: "device-a", session, extraArgs });
    let b = await startBrowser(t, { name: "device-b", extraArgs });
    const titleA = `Sync A ${run}`;
    const titleB = `Sync B ${run}`;
    const urlA = t.fixtures.url.page(1, `sync-a-${run}`);
    const urlB = t.fixtures.url.page(2, `sync-b-${run}`);

    await t.check("Linux advertises the sync module and one browser renderer owns sync", async () => {
      const capabilities = await a.shell.eval("__ardiaHost.bootstrap.capabilities.filter((c) => c.startsWith('ArdiaSync.'))");
      if (!capabilities.includes("ArdiaSync.write") || !capabilities.includes("ArdiaSync.claimAuthority")) throw new Error(JSON.stringify(capabilities));
      const status = await until(() => syncState(a.shell).then((s) => (s.status === "off" ? s : false)), { timeout: 20000, label: "sync off and available" });
      const shells = await until(async () => {
        const list = (await a.app.shells()).filter((s) => s.ready && !s.utility);
        if (list.length < 2) return false;
        const opened = await Promise.all(list.map((s) => a.app.shell(s.windowId)));
        const roles = await Promise.all(opened.map(syncRole));
        return roles.filter((role) => role === "authority").length === 1 && roles.every((role) => role === "authority" || role === "claiming") ? { opened, roles } : false;
      }, { timeout: 30000, label: "a single sync authority across two windows" });
      const follower = shells.opened[shells.roles.indexOf("claiming")];
      const refused = await follower.invoke("ArdiaSync.write", { args: [shared, "app", "{}"] });
      if (refused.ok || refused.code !== "ERR_SYNC_NOT_AUTHORITY") throw new Error(`a second renderer wrote to the folder: ${JSON.stringify(refused)}`);
      const followerState = await until(() => syncState(follower).then((s) => (s.status === "off" ? s : false)), { timeout: 10000, label: "the second window mirrors the authority" });
      return { capabilities: capabilities.length, status: status.status, roles: shells.roles, refused: refused.code, mirrored: followerState.status };
    }, { critical: true });

    let phrase;
    await t.check("turning on sync seals everything it writes and keeps the key out of the folder", async () => {
      const result = await syncCall(a.shell, "turnOnSync", shared);
      if (!result || !result.ok) throw new Error(JSON.stringify(result));
      await addBookmark(a.shell, urlA, titleA);
      await syncedUntil([a.shell], async () => (await syncState(a.shell)).status === "updated", "device A synced");
      phrase = await phraseFromKeyStore(a.scratch, await deviceIdOf(a.scratch));
      const leaks = await folderLeaks(shared, [titleA, urlA, run, hostname(), phrase]);
      if (leaks.length) throw new Error(leaks.join("; "));
      return { files: (await walkFolder(shared)).length };
    }, { critical: true });

    await t.check("a wrong or short phrase is refused and the right one joins", async () => {
      const stranger = phraseWords(randomBytes(32), wordlistFrom(WORDLIST)).join(" ");
      const mismatch = await syncCall(b.shell, "enterRecoveryPhrase", shared, stranger);
      if (mismatch?.error !== "mismatch") throw new Error(`a stranger's phrase: ${JSON.stringify(mismatch)}`);
      const short = await syncCall(b.shell, "enterRecoveryPhrase", shared, phrase.split(" ").slice(0, 23).join(" "));
      if (short?.error !== "wordCount") throw new Error(`23 words: ${JSON.stringify(short)}`);
      const numbered = phrase.split(" ").map((word, i) => `${i + 1}. ${word.toUpperCase()}`).join("\n");
      const joined = await syncCall(b.shell, "enterRecoveryPhrase", shared, numbered);
      if (!joined?.ok) throw new Error(JSON.stringify(joined));
      return { mismatch: mismatch.error, short: short.error };
    }, { critical: true });

    await t.check("bookmarks go both ways between the two profiles", async () => {
      await syncedUntil([b.shell, a.shell], () => hasBookmark(b.shell, titleA), "A's bookmark on B");
      await addBookmark(b.shell, urlB, titleB);
      await syncedUntil([b.shell, a.shell], () => hasBookmark(a.shell, titleB), "B's bookmark on A");
      const leaks = await folderLeaks(shared, [titleA, titleB, urlA, urlB, run, hostname()]);
      if (leaks.length) throw new Error(leaks.join("; "));
      return { devices: (await syncState(a.shell)).devices.length };
    });

    await t.check("a restarted device keeps syncing from its stored key", async () => {
      b = await restartBrowser(t, b, { extraArgs });
      const status = await until(() => syncState(b.shell).then((s) => (s.enabled && s.status !== "starting" ? s : false)), { timeout: 30000, label: "B resumed" });
      if (status.status === "locked") throw new Error(`B is locked after a restart: ${status.error}`);
      const titleAfter = `${titleA} after restart`;
      await addBookmark(a.shell, urlA, titleAfter);
      await syncedUntil([a.shell, b.shell], () => hasBookmark(b.shell, titleAfter), "A's new bookmark on restarted B");
      return { status: status.status };
    });

    await t.check("stopping sync on B keeps its data and removes its key", async () => {
      await syncCall(b.shell, "stopSync", {});
      const status = await until(() => syncState(b.shell).then((s) => (s.status === "off" ? s : false)), { timeout: 30000, label: "B off" });
      const keys = (await readdir(join(b.scratch, KEY_DIRECTORY)).catch(() => [])).filter((name) => name.startsWith("sync-key-"));
      if (keys.length) throw new Error(`B kept ${keys.length} sync key files`);
      if (!(await hasBookmark(b.shell, titleA))) throw new Error("stopping sync removed a synced bookmark");
      return { status: status.status };
    });
    await t.stop(b.app);
    await t.stop(a.app);
    a = null;
  },
};
