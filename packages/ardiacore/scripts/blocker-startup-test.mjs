import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { constants, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { launch, sleep } from "../../../scripts/lib/instance.mjs";

assert.ok(process.argv[2], "Usage: node packages/ardiacore/scripts/blocker-startup-test.mjs <Debug Ardia.app>");
const application = realpathSync(resolve(process.argv[2]));
assert.ok(!application.startsWith("/Applications/"), "Use a test build, never an installed browser");
assert.ok(existsSync(join(application, "Contents/Resources/Extensions/adnauseam/manifest.json")), "The test build must include AdNauseam");
const work = mkdtempSync(join(tmpdir(), "ardia-blocker-startup-"));
const copyRoot = mkdtempSync(join(dirname(application), "ardia-blocker-startup-"));
const withoutAdNauseam = join(copyRoot, basename(application));
const results = [];
let app;
let locked;
let registeredCopy = false;

const preferences = data => join(data, "Chromium", "Content Blocker.json");
const saved = data => JSON.parse(readFileSync(preferences(data), "utf8"));
const prepare = name => {
  const data = join(work, name);
  mkdirSync(join(data, "Chromium"), { recursive: true });
  writeFileSync(preferences(data), JSON.stringify({ provider: "adnauseam", clickAds: true }));
  return data;
};

async function check(name, bundle, data, availableProviders, verify = () => {}) {
  try {
    if (bundle === withoutAdNauseam) registeredCopy = true;
    app = await launch(bundle, { data, onboarded: true });
    let state;
    const deadline = Date.now() + 30000;
    do {
      state = await app.eval("return expo.modules.ArdiaCEF.getContentBlocker();", { timeout: 10000 });
      if (state.stats.ready) break;
      await sleep(100);
    } while (Date.now() < deadline);
    assert.equal(state.stats.ready, true, JSON.stringify(state));
    assert.equal(state.provider, "ublock");
    assert.equal(state.selectedProvider, "ublock");
    assert.equal(state.clickAds, false);
    assert.equal(state.enabled, true);
    assert.deepEqual([...state.availableProviders].sort(), [...availableProviders].sort());
    verify(app.output());
    results.push({ name, passed: true });
    console.log("PASS", name);
  } catch (error) {
    results.push({ name, passed: false, error: String(error) });
    throw error;
  } finally {
    if (app) await app.quit();
    app = null;
  }
}

try {
  cpSync(application, withoutAdNauseam, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
  rmSync(join(withoutAdNauseam, "Contents/Resources/Extensions/adnauseam"), { recursive: true });
  execFileSync("codesign", ["--force", "--sign", "-", "--preserve-metadata=identifier,entitlements,flags", withoutAdNauseam], { stdio: "pipe" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", withoutAdNauseam], { stdio: "pipe" });

  const normal = prepare("writable");
  const reset = data => assert.deepEqual(saved(data), { provider: "ublock", clickAds: false });
  await check("missing AdNauseam clears the selection and consent on disk", withoutAdNauseam, normal, ["ublock"], () => reset(normal));
  await check("the fallback persists across restart", withoutAdNauseam, normal, ["ublock"], () => reset(normal));
  await check("restoring the bundle does not restore clicking consent", application, normal, ["ublock", "adnauseam"], () => reset(normal));

  const unwritable = prepare("unwritable");
  locked = preferences(unwritable);
  execFileSync("chflags", ["uchg", locked]);
  await check("an unwritable preference still falls back with consent off in memory", withoutAdNauseam, unwritable, ["ublock"], output => {
    assert.deepEqual(saved(unwritable), { provider: "adnauseam", clickAds: true });
    assert.match(output, /unavailable provider fallback: couldn't save/);
  });
  execFileSync("chflags", ["nouchg", locked]);
  locked = null;
  await check("the next launch saves the fallback once preferences are writable", withoutAdNauseam, unwritable, ["ublock"], () => reset(unwritable));
  await check("a repaired fallback stays selected with the full bundle", application, unwritable, ["ublock", "adnauseam"], () => reset(unwritable));
} finally {
  if (locked) execFileSync("chflags", ["nouchg", locked]);
  if (app) await app.quit();
  writeFileSync(join(work, "results.json"), JSON.stringify({ results, work }, null, 2) + "\n");
  if (registeredCopy) spawnSync("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", ["-u", withoutAdNauseam]);
  rmSync(copyRoot, { recursive: true, force: true });
  console.log(`${results.filter(result => result.passed).length}/${results.length} passed. Results: ${join(work, "results.json")}`);
}
