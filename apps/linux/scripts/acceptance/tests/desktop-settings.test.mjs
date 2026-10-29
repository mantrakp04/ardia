import assert from "node:assert/strict";
import { access, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { desktopTools, privateRuntime, SOCKET_PATH_MAX, startDesktop } from "../lib/desktop.mjs";
import { startKeyring } from "../lib/desktopKeyring.mjs";
import { freshenHistory, summaryLine } from "../lib/desktopImport.mjs";
import { writeImportFixtures } from "../lib/importFixtures.mjs";
import { colorBox } from "../scenarios/d-drag.mjs";
import { POLKITD, polkitBusConfig, runPrivatePolkit, subordinateIds } from "../scenarios/d-package.mjs";
import { driveWrapper, OTHER_UID } from "../scenarios/d-trash.mjs";
import { fixtureSecret } from "../lib/fixtureSecrets.mjs";

const SAFE_STORAGE_SECRET = fixtureSecret("safe-storage-");

const tools = await desktopTools();

async function scratch(name) {
  return mkdtemp(join(tmpdir(), `ardia-${name}-`));
}

test("secret_items.py creates, reads, locks and unlocks items in a private gnome-keyring", { skip: !tools.dbusDaemon || !tools.keyring ? "needs dbus-daemon and gnome-keyring-daemon" : false }, async () => {
  const dir = await scratch("keyring");
  const desktop = await startDesktop(dir, { tools, compositor: false, system: false });
  try {
    const keyring = await startKeyring(desktop, { items: [{ label: "Chrome Safe Storage", attributes: { application: "chrome", "xdg:schema": "chrome_libsecret_os_crypt_password_v2" }, secret: SAFE_STORAGE_SECRET }] });
    const [item] = await keyring.search({ application: "chrome" }, { secrets: true });
    assert.equal(item.label, "Chrome Safe Storage");
    assert.equal(item.attributes["xdg:schema"], "chrome_libsecret_os_crypt_password_v2");
    assert.equal(item.secret, SAFE_STORAGE_SECRET);
    await keyring.lock();
    assert.equal(await keyring.locked(), true);
    const [locked] = await keyring.search({ application: "chrome" }, { secrets: true });
    assert.equal(locked.locked, true);
    assert.equal(locked.secret, undefined);
    await keyring.unlock();
    assert.equal(await keyring.locked(), false);
    await keyring.stop();
  } finally {
    await desktop.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("freshenHistory moves the Chrome fixture's visits inside Chromium's 90-day window, newest first", async () => {
  const home = await scratch("history");
  try {
    await writeImportFixtures(home, { largeHistory: 2 });
    const now = Date.UTC(2026, 9, 28);
    assert.equal(freshenHistory(home, { nowMs: now }), 4);
    const db = new DatabaseSync(join(home, ".config", "google-chrome", "Default", "History"), { readOnly: true });
    const query = db.prepare("SELECT url, last_visit_time FROM urls ORDER BY last_visit_time DESC");
    query.setReadBigInts(true);
    const rows = query.all();
    db.close();
    const toMs = (webkit) => Number(BigInt(webkit) - 11644473600000000n) / 1000;
    assert.equal(rows[0].url, "https://visited-1.ardia.test/");
    assert.equal(toMs(rows[0].last_visit_time), now - 3600000);
    assert.ok(rows.every((row) => now - toMs(row.last_visit_time) < 90 * 86400000));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("summaryLine picks the Done step's summary", () => {
  assert.equal(summaryLine("You're all set\nImported 4 bookmarks, 3 history items.\nFinish importing"), "Imported 4 bookmarks, 3 history items.");
  assert.equal(summaryLine("You're all set\nThere was nothing new to import.\n"), "There was nothing new to import.");
  assert.equal(summaryLine("Unlock your data for import\nContinue"), null);
});

test("colorBox finds the bounding box of a colour in a captured frame", () => {
  const width = 40;
  const height = 30;
  const data = Buffer.alloc(width * height * 3, 255);
  for (let y = 10; y <= 20; y++) for (let x = 6; x <= 30; x++) data.set([240, 16, 160], (y * width + x) * 3);
  assert.deepEqual(colorBox({ width, height, data }, [240, 16, 160]), { x: 6, y: 10, width: 24, height: 10 });
  assert.equal(colorBox({ width, height, data: Buffer.alloc(width * height * 3, 0) }, [240, 16, 160]), null);
});

test("the removable-drive wrapper mounts a world-writable tmpfs in a user namespace and drops back to the caller's uid", () => {
  const script = driveWrapper({ executable: "/opt/ardia/chrome", drive: "/tmp/x/drive", foreign: true, uid: 1000, gid: 1000, sub: { uid: 100000, gid: 200000 } });
  assert.match(script, /^#!\/bin\/sh\nexec unshare /);
  for (const part of ["--map-users=0:100000:1", "--map-users=1000:1000:1", `--map-users=${OTHER_UID}:100001:1`, "--map-groups=0:200000:1", "--setgroups allow", "--mount", "--setuid 0"]) assert.ok(script.includes(part), part);
  assert.match(script, /mount -t tmpfs -o mode=0777,size=64m ardia-drive '\/tmp\/x\/drive'/);
  assert.match(script, new RegExp(`chown ${OTHER_UID}:${OTHER_UID} '/tmp/x/drive/.Trash-1000'`));
  assert.match(script, /exec setpriv --reuid=1000 --regid=1000 --clear-groups '\/opt\/ardia\/chrome'/);
  assert.doesNotMatch(driveWrapper({ executable: "/a", drive: "/d", foreign: false, uid: 1000, gid: 1000, sub: { uid: 1, gid: 1 } }), /chown/);
});

const POLICY_SOURCE = new URL("../../../../../scripts/linux/dev.ardia.linux.policy", import.meta.url).pathname;
const ids = await subordinateIds();
const polkitSkip = !ids ? "needs an /etc/subuid and /etc/subgid range" : !(await access(POLKITD).then(() => true, () => false)) ? `needs ${POLKITD}` : !tools.dbusDaemon ? "needs dbus-daemon" : false;
const polkitdUid = ids ? Number(ids.users.split(":")[1]) + 101 : null;

async function processesOf(uid, dir) {
  const found = [];
  for (const pid of (await readdir("/proc")).filter((name) => /^\d+$/.test(name))) {
    const status = await readFile(`/proc/${pid}/status`, "utf8").catch(() => "");
    const cmdline = (await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "")).replaceAll("\0", " ");
    if (new RegExp(`^Uid:\\s+${uid}\\b`, "m").test(status) || cmdline.includes(dir)) found.push(`${pid} ${cmdline.slice(0, 80)}`);
  }
  return found;
}

test("a private polkitd in a user and PID namespace reads a bind-mounted policy, and nothing of it outlives the run", { skip: polkitSkip }, async () => {
  const dir = await scratch("polkitd");
  try {
    const result = await runPrivatePolkit(dir, POLICY_SOURCE, { ids, timeout: 30000 });
    assert.equal(result.timedOut, false);
    assert.equal(result.code, 0, `${result.log} ${result.out}`);
    assert.match(result.out, /^dev\.ardia\.linux\.reauthenticate:/);
    assert.match(result.out, /implicit active:\s*auth_self/);
    assert.deepEqual(await processesOf(polkitdUid, dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a private polkitd still running at its deadline is killed with its bus", { skip: polkitSkip }, async () => {
  const dir = await scratch("polkitd-hold");
  try {
    const started = Date.now();
    const result = await runPrivatePolkit(dir, POLICY_SOURCE, { ids, timeout: 6000, hold: 120 });
    assert.equal(result.timedOut, true);
    assert.ok(Date.now() - started < 20000);
    assert.match(result.out, /implicit active:\s*auth_self/, "polkitd answered before the deadline");
    assert.deepEqual(await processesOf(polkitdUid, dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the private polkitd bus lets the namespace's polkitd user connect", () => {
  const config = polkitBusConfig("/tmp/p/system-bus", "/tmp/p/services");
  assert.match(config, /<type>system<\/type>/);
  assert.match(config, /<allow user="\*"\/>/);
  assert.match(config, /<listen>unix:path=\/tmp\/p\/system-bus<\/listen>/);
});

test("a private runtime folder moves to a short temporary path when sway's IPC socket wouldn't fit", async () => {
  const short = await scratch("rt");
  const deep = join(short, "a".repeat(40), "b".repeat(40));
  try {
    const near = await privateRuntime(short);
    assert.equal(near.temporary, false);
    assert.equal(near.runtime, join(short, "runtime"));
    const far = await privateRuntime(deep);
    assert.equal(far.temporary, true);
    assert.ok(join(far.runtime, "sway-ipc.4294967295.4294967295.sock").length <= SOCKET_PATH_MAX);
    await rm(far.runtime, { recursive: true, force: true });
  } finally {
    await rm(short, { recursive: true, force: true });
  }
});
