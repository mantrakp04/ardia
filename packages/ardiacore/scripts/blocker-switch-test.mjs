import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { constants, cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { devtools, launch, session, sleep } from "../../../scripts/lib/instance.mjs";

assert.ok(process.argv[2], "Usage: node packages/ardiacore/scripts/blocker-switch-test.mjs <Debug Ardia.app>");
const application = realpathSync(resolve(process.argv[2]));
assert.ok(!application.startsWith("/Applications/"), "Use a test build, never an installed browser");
assert.ok(existsSync(join(application, "Contents/Resources/Extensions/adnauseam/manifest.json")), "The test build must include AdNauseam");
const work = mkdtempSync(join(tmpdir(), "ardia-blocker-switch-"));
const copyRoot = mkdtempSync(join(dirname(application), "ardia-blocker-switch-"));
const fixture = join(copyRoot, basename(application));
const ublockManifest = join(fixture, "Contents/Resources/Extensions/ublock/manifest.json");
const adnauseamManifest = join(fixture, "Contents/Resources/Extensions/adnauseam/manifest.json");
const ublockBackground = join(fixture, "Contents/Resources/Extensions/ublock/js/background.js");
const results = [];
let app;
let originalManifest;
let originalAdNauseamManifest;
let originalBackground;
let registered = false;

const cef = call => app.eval(`return expo.modules.ArdiaCEF.${call};`, { timeout: 60000 });
const state = () => cef("getContentBlocker()");
const select = provider => cef(`setContentBlockerProvider(${JSON.stringify(provider)}, ${provider === "adnauseam"})`);
const until = async (name, read) => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await read()) return;
    await sleep(100);
  }
  throw new Error(`Timed out: ${name}`);
};
const start = async name => {
  registered = true;
  app = await launch(fixture, { data: join(work, name), onboarded: true, session: session({
    profiles: ["Personal", "Work"], windows: [{ profileId: "default" }, { profileId: "work" }],
    tabs: [{ id: "personal", windowId: "w1", url: "about:blank" }, { id: "work", windowId: "w2", url: "data:text/html,<title>Blocker-Work</title>" }],
  }) });
  await until("both profiles' blockers", async () => (await state()).stats.ready && (await backgrounds()).length === 2);
};
const backgrounds = async () => (await app.targets()).filter(target => target.type === "background_page" && /chrome-extension:\/\/(fajbdaomknpkicfjcpipdmcpoamdmilh|kmggppiioddbnikpjfodfabgmboeihij)\//.test(target.url));
const verifyPaused = async provider => {
  const current = await state();
  assert.equal(current.provider, provider);
  assert.equal(current.stats.ready, true);
  assert.equal(current.enabled, false, "provider switching must preserve paused protection");
  assert.equal(current.clickAds, provider === "adnauseam");
  const pages = await backgrounds();
  assert.equal(pages.length, 2);
  for (const target of pages) {
    const page = await devtools(target);
    try {
      const read = await page.eval("µBlock.isReadyPromise.then(() => ({paused: !µBlock.getNetFilteringSwitch('https://example.test/'), gate: self.ardiaClickConsent === true, autoUpdate: µBlock.userSettings.autoUpdate}))");
      assert.equal(read.paused, true, JSON.stringify(read));
      assert.equal(read.gate, false, "paused profiles must never grant background clicking");
      assert.equal(read.autoUpdate, false);
    } finally {
      page.close();
    }
  }
};
const check = async (name, run) => {
  try {
    await run();
    results.push({ name, passed: true });
    console.log("PASS", name);
  } catch (error) {
    results.push({ name, passed: false, error: String(error) });
    console.error("FAIL", name, String(error));
  } finally {
    if (originalManifest) writeFileSync(ublockManifest, originalManifest);
    if (originalAdNauseamManifest) writeFileSync(adnauseamManifest, originalAdNauseamManifest);
    if (originalBackground) writeFileSync(ublockBackground, originalBackground);
    if (app) await app.quit();
    app = null;
  }
};

try {
  cpSync(application, fixture, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
  originalManifest = readFileSync(ublockManifest);
  originalAdNauseamManifest = readFileSync(adnauseamManifest);
  originalBackground = readFileSync(ublockBackground);
  execFileSync("codesign", ["--verify", "--deep", "--strict", fixture], { stdio: "pipe" });
  await check("paused protection survives restart and first activation in both profiles", async () => {
    await start("paused");
    await cef("setContentBlockerEnabled(false)");
    await app.quit();
    app = null;
    await start("paused");
    await cef("devContentBlockerFailNextMessage()");
    await assert.rejects(select("adnauseam"), /Couldn't read the current blocker's protection setting/);
    await verifyPaused("ublock");
    await select("adnauseam");
    await verifyPaused("adnauseam");
    await select("ublock");
    await verifyPaused("ublock");
    await cef("setContentBlockerEnabled(true)");
    await select("adnauseam");
    assert.equal((await state()).enabled, true, "an old provider-specific pause must not override resumed protection");
    for (const target of await backgrounds()) {
      const page = await devtools(target);
      try { assert.equal(await page.eval("self.ardiaClickConsent"), true); } finally { page.close(); }
    }
  });
  await check("an activation failure restores paused uBlock in every profile", async () => {
    await start("restore-paused");
    await cef("setContentBlockerEnabled(false)");
    writeFileSync(adnauseamManifest, JSON.stringify({ ...JSON.parse(originalAdNauseamManifest), version: "invalid" }));
    await assert.rejects(select("adnauseam"), /protection paused/);
    await verifyPaused("ublock");
  });
  await check("a healthy default profile cannot hide another profile's failed fallback", async () => {
    await start("partial-fallback");
    const pages = await backgrounds();
    let marked = false;
    for (const target of pages) {
      const page = await devtools(target);
      try {
        const secondary = await page.eval("chrome.tabs.query({}).then(tabs => tabs.some(tab => tab.url?.includes('Blocker-Work')))");
        if (!secondary) continue;
        await page.eval("chrome.storage.local.set({ardiaTestFailReadiness: true})");
        marked = true;
      } finally {
        page.close();
      }
    }
    assert.equal(marked, true, "mark only the secondary profile for failure");
    writeFileSync(ublockBackground, originalBackground + "\nif ((await chrome.storage.local.get('ardiaTestFailReadiness')).ardiaTestFailReadiness) { µBlock.isReadyPromise = Promise.reject(new Error('fixture readiness failure')); µBlock.isReadyPromise.catch(() => {}); }\n");
    writeFileSync(adnauseamManifest, JSON.stringify({ ...JSON.parse(originalAdNauseamManifest), version: "invalid" }));
    await assert.rejects(select("adnauseam"), /uBlock Origin could not be restored/);
    const states = [];
    for (const target of await backgrounds()) {
      const page = await devtools(target);
      try { states.push(await page.eval("µBlock.isReadyPromise.then(() => true, () => false)")); } finally { page.close(); }
    }
    assert.deepEqual(states.sort(), [false, true]);
    assert.equal((await state()).stats.ready, false, "the default profile alone must not report successful activation");
    writeFileSync(ublockBackground, originalBackground);
    writeFileSync(adnauseamManifest, originalAdNauseamManifest);
    await select("ublock");
    assert.equal((await state()).stats.ready, true);
    for (const target of await backgrounds()) {
      const page = await devtools(target);
      try { assert.equal(await page.eval("µBlock.isReadyPromise.then(() => true, () => false)"), true); } finally { page.close(); }
    }
  });
  await check("failed fallback stays unavailable until a successful retry restores all profiles", async () => {
    await start("fallback");
    writeFileSync(ublockManifest, JSON.stringify({ ...JSON.parse(originalManifest), version: "invalid" }));
    writeFileSync(adnauseamManifest, JSON.stringify({ ...JSON.parse(originalAdNauseamManifest), version: "invalid" }));
    await assert.rejects(select("adnauseam"), /uBlock Origin could not be restored/);
    writeFileSync(ublockManifest, originalManifest);
    writeFileSync(adnauseamManifest, originalAdNauseamManifest);
    for (let read = 0; read < 3; read++) {
      const failed = await state();
      assert.equal(failed.stats.ready, false, "a readable default profile must not hide a failed multi-profile fallback");
      assert.equal(failed.enabled, false);
      assert.equal(failed.clickAds, false);
      assert.ok(failed.stats.error);
      await sleep(250);
    }
    const preferences = join(app.data, "Chromium", "Content Blocker.json");
    execFileSync("chflags", ["uchg", preferences]);
    try {
      await assert.rejects(select("ublock"), /couldn't save/);
      assert.equal((await state()).stats.ready, false, "an unsuccessful retry must preserve the fallback failure");
    } finally {
      execFileSync("chflags", ["nouchg", preferences]);
    }
    await select("ublock");
    assert.equal((await state()).stats.ready, true);
    assert.equal((await backgrounds()).length, 2, "recovery must reload every profile");
  });
} finally {
  if (app) await app.quit();
  writeFileSync(join(work, "results.json"), JSON.stringify({ results, work }, null, 2) + "\n");
  if (registered) spawnSync("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", ["-u", fixture]);
  rmSync(copyRoot, { recursive: true, force: true });
  console.log(`${results.filter(result => result.passed).length}/${results.length} passed. Results: ${join(work, "results.json")}`);
}
if (results.some(result => !result.passed)) process.exitCode = 1;
