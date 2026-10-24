import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { launch, devtools, sleep } from "../../../scripts/lib/instance.mjs";

const [app, output, ...only] = process.argv.slice(2);
if (!app || !output) throw new Error("usage: node custom-filters-failure-test.mjs <Debug app> <output> [check name…]");
const out = resolve(output);
mkdirSync(out, { recursive: true });
const results = [];
let version = 1;
let updating = false;
let updateRequests = 0;
const server = createServer((req, res) => {
  const [path] = req.url.split("?");
  if (path === "/missing.txt") {
    res.writeHead(404);
    return res.end("missing");
  }
  if (path === "/second.txt") {
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end("! Title: Second failure fixture\n127.0.0.1##.second\n");
  }
  const failed = updating && ++updateRequests > 1;
  res.writeHead(failed ? 500 : 200, { "content-type": "text/plain" });
  res.end(failed ? "failed follower" : `! Title: Failure E2E\n127.0.0.1##.version-${version}\n`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
let inst;
const connections = [];
const until = async (what, test, ms = 90000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await test();
    if (value) return value;
    if (!inst.alive) throw new Error("test instance exited");
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${what}`);
};
const call = (body) => inst.eval(`return globalThis.expo.modules.ArdiaCEF.${body}`, { timeout: 200000 });
const outcome = (body) => call(`${body}.then(() => null, (e) => e.message)`);
const connect = async (target) => {
  const page = await devtools(target);
  connections.push(page);
  return page;
};
const UBLOCK = "chrome-extension://fajbdaomknpkicfjcpipdmcpoamdmilh/";
const backgroundPages = async () =>
  (await (await fetch(`http://127.0.0.1:${inst.port}/json/list`)).json()).filter((t) => t.type === "background_page" && t.url.startsWith(UBLOCK));
const check = async (name, run) => {
  if (only.length && !only.includes(name)) return;
  try {
    const evidence = await run();
    results.push({ name, ok: true, evidence });
    console.log(`PASS ${name} ${JSON.stringify(evidence)}`);
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
    console.log(`FAIL ${name} ${error.message}`);
  }
};
const pendingRecords = (background) =>
  background.eval(`new Promise((r) => chrome.storage.local.get(["ardiaPendingFilterImport", "ardiaReloadPending"], r))`);
const importedIn = (background) =>
  background.eval(`µBlock.getAvailableLists().then((lists) => Object.keys(lists).filter((id) => lists[id].group === "custom").sort())`);
try {
  inst = await launch(resolve(app), { data: join(out, "data"), fresh: true, onboarded: true });
  await until("the content blocker", async () => (await call("getContentBlocker()"))?.stats?.ready);
  const [defaultTarget] = await backgroundPages();
  assert(defaultTarget, "missing default extension background page");
  const primaryBackground = await connect(defaultTarget);
  await primaryBackground.eval("globalThis.__pr65default = true");
  const profile = await inst.eval(`return ac.store.getState().createProfile({name: "Failure follower"})`);
  await inst.eval(`return ac.actions.openWindow({profileId: ${JSON.stringify(profile)}, url: "about:blank"})`);
  const followerTarget = await until("the follower's background page", async () => (await backgroundPages()).find((t) => t.id !== defaultTarget.id));
  const followerBackground = await connect(followerTarget);
  assert(!(await followerBackground.eval("globalThis.__pr65default === true")), "the follower background is the default one");
  for (const background of [primaryBackground, followerBackground])
    await until("uBlock Origin's background page", () => background.eval(
      "typeof µBlock === 'object' && typeof vAPI?.messaging?.defaultHandler === 'function' && µBlock.isReadyPromise.then(() => true)"), 30000);
  await call(`addFilterList(${JSON.stringify(`${origin}/list.txt`)})`);

  await check("follower-update-failure-propagates", async () => {
    version = 2;
    updating = true;
    const error = await outcome(`updateFilterList(${JSON.stringify(`${origin}/list.txt`)})`);
    updating = false;
    assert(error?.includes("Couldn't update the list"), `follower failure was swallowed: ${JSON.stringify({ error, updateRequests })}`);
    return { error, updateRequests };
  });
  updating = false;

  await check("add-cleanup-failure-does-not-sync", async () => {
    const missing = `${origin}/missing.txt`;
    const second = `${origin}/second.txt`;
    try {
      await primaryBackground.eval(`
        globalThis.__pr65SwallowRollback = true;
        globalThis.__pr65Handler = vAPI.messaging.defaultHandler;
        vAPI.messaging.defaultHandler = function(message, sender, callback) {
          if (globalThis.__pr65SwallowRollback && message.what === "applyFilterListSelection" && message.toRemove?.includes(${JSON.stringify(missing)}))
            return callback();
          return globalThis.__pr65Handler.call(this, message, sender, callback);
        };
        true
      `);
      const addError = await outcome(`addFilterList(${JSON.stringify(missing)})`);
      assert(addError?.includes("cleanup failed"), `cleanup failure not identified: ${addError}`);
      const secondWhileFailing = await outcome(`addFilterList(${JSON.stringify(second)})`);
      const whileFailing = { secondWhileFailing, primary: await importedIn(primaryBackground), follower: await importedIn(followerBackground) };
      assert(!whileFailing.follower.includes(missing), `the rejected list synchronized to the follower: ${JSON.stringify(whileFailing)}`);
      assert(secondWhileFailing, `another import ran while the rollback was still failing: ${JSON.stringify(whileFailing)}`);
      await primaryBackground.eval("globalThis.__pr65SwallowRollback = false; true");
      const secondError = await outcome(`addFilterList(${JSON.stringify(second)})`);
      const recovered = {
        secondError,
        primary: await importedIn(primaryBackground),
        follower: await importedIn(followerBackground),
        records: await pendingRecords(primaryBackground),
      };
      assert.equal(secondError, null, `the second import failed after the rollback recovered: ${JSON.stringify(recovered)}`);
      for (const [where, lists] of [["default", recovered.primary], ["follower", recovered.follower]]) {
        assert(!lists.includes(missing), `the rejected list is still imported in the ${where} profile: ${JSON.stringify(recovered)}`);
        assert(lists.includes(second), `the second list is missing in the ${where} profile: ${JSON.stringify(recovered)}`);
      }
      assert.deepEqual(recovered.records, {}, `rollback state left behind: ${JSON.stringify(recovered.records)}`);
      return { addError, whileFailing, recovered };
    } finally {
      await primaryBackground.eval("if (globalThis.__pr65Handler) vAPI.messaging.defaultHandler = globalThis.__pr65Handler; delete globalThis.__pr65Handler; delete globalThis.__pr65SwallowRollback; true");
    }
  });
} finally {
  for (const page of connections) page.close();
  if (inst) await inst.quit();
  server.close();
  writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 2));
  const expected = only.length || 2;
  process.exitCode = results.length !== expected || results.some((r) => !r.ok) ? 1 : 0;
}
