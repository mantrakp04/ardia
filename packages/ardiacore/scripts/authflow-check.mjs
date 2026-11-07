#!/usr/bin/env node
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { devtools, launch, session, sleep } from "../../../scripts/lib/instance.mjs";

const [appArg, scratchArg] = process.argv.slice(2);
if (!appArg) {
  console.error("usage: authflow-check.mjs <Ardia.app> [scratch dir]\n\nchrome.identity.launchWebAuthFlow and getAuthToken in a hidden instance: silent and interactive sign-in,\ncancel by closing the sign-in window, a private window open, and a relaunch afterwards.");
  process.exit(64);
}
const scratch = resolve(scratchArg ?? join(process.env.TMPDIR ?? "/tmp", `ac-authflow-check-${process.pid}`));
rmSync(scratch, { recursive: true, force: true });
const ext = join(scratch, "ext");
mkdirSync(ext, { recursive: true });
writeFileSync(join(ext, "manifest.json"), JSON.stringify({
  manifest_version: 3, name: "Auth flow check", version: "1.0",
  permissions: ["identity"], background: { service_worker: "sw.js" },
}));
writeFileSync(join(ext, "sw.js"), `
self.flow = (url, interactive) => chrome.identity.launchWebAuthFlow({ url, interactive }).then((ok) => ({ ok }), (e) => ({ error: e.message }));
self.token = (interactive) => chrome.identity.getAuthToken({ interactive }).then((ok) => ({ ok }), (e) => ({ error: e.message }));
`);

let extensionId = "";
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const back = `https://${extensionId}.chromiumapp.org/cb?code=check-code&state=${url.searchParams.get("state") ?? ""}`;
  if (url.pathname === "/silent") return res.writeHead(302, { Location: back }).end();
  if (url.pathname === "/signin") return res.end(`<!doctype html><title>Check sign-in</title><a id="allow" href="${back}">Allow</a>`);
  res.end("<!doctype html><title>Auth flow check page</title><p>page</p>");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const pageUrl = `${origin}/page`;

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const until = async (what, fn, ms = 10000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) {
    const v = await fn().catch(() => null);
    if (v) return v;
  }
  throw new Error(`timed out waiting for ${what}`);
};

const data = join(scratch, "data");
const launchOpts = {
  data, onboarded: true,
  switches: [`--load-extension=${ext}`, "--disable-features=DisableLoadExtensionCommandLineSwitch"],
};
let app = await launch(appArg, {
  ...launchOpts,
  session: session({ tabs: [{ id: "t1", url: pageUrl, title: "Auth flow check page" }, { id: "t2", url: `${pageUrl}?2` }] }),
});
const state = () => app.eval(`
  const s = ac.store.getState();
  return ac.engine.call("engine.info", {}).then((info) => ({
    windows: s.windowOrder.length,
    tabs: s.windowOrder.filter((id) => !s.windows[id]?.incognito && !s.windows[id]?.profileId?.startsWith("incognito:")).flatMap((id) => s.windows[id].tabIds.map((t) => s.tabs[t]?.url)),
    popupWindows: info.popupWindows,
  }));`);
const signinTarget = () => app.pageTarget((t) => t.url.startsWith(`${origin}/signin`));
const popupWindowNumber = async () => {
  const listed = new Set((await app.eval(`return ac.engine.call("windows.list", {}).then((l) => l.map((w) => w.window))`)));
  return app.windows().find((n) => !listed.has(n)) ?? null;
};
try {
  const worker = await until("the extension's service worker", async () => {
    const t = (await app.targets()).find((x) => x.type === "service_worker" && x.url.endsWith("/sw.js"));
    return t ? devtools(t) : null;
  }, 90000);
  extensionId = await worker.eval("chrome.runtime.id");
  await until("the session's tabs", async () => (await state()).tabs.length === 2);
  const before = await state();
  const run = (expression, timeout = 30000) => worker.eval(expression, { timeout });

  const silent = await run(`flow(${JSON.stringify(`${origin}/silent?state=s1`)}, false)`);
  check("non-interactive flow that redirects resolves with the redirect URL", silent.ok?.includes(".chromiumapp.org/cb?code=check-code&state=s1"), JSON.stringify(silent));
  const needs = await run(`flow(${JSON.stringify(`${origin}/signin?state=s2`)}, false)`);
  check("non-interactive flow that needs the user fails cleanly", needs.error?.startsWith("User interaction required."), JSON.stringify(needs));
  check("no sign-in page left behind", !(await signinTarget()));

  const signIn = async (stateParam, finish) => {
    const pending = run(`flow(${JSON.stringify(`${origin}/signin?state=${stateParam}`)}, true)`, 20000).catch((e) => ({ error: e.message }));
    const target = await until("the sign-in page", signinTarget).catch(() => null);
    await sleep(800);
    const during = await state();
    const windowNumber = await popupWindowNumber();
    await finish(target, windowNumber);
    const result = await pending;
    const left = await signinTarget();
    if (left) await (await app.browser()).send("Target.closeTarget", { targetId: left.id }).catch(() => {});
    return { result, during, windowNumber };
  };

  const allowed = await signIn("s3", async (target) => {
    if (!target) return;
    const page = await devtools(target);
    await page.eval(`document.getElementById("allow").click()`).catch(() => {});
    page.close();
  });
  check("interactive sign-in shows its page in a popup window", allowed.during.popupWindows === 1 && !!allowed.windowNumber, JSON.stringify({ popupWindows: allowed.during.popupWindows, window: allowed.windowNumber }));
  check("the sign-in page doesn't join the user's tabs", JSON.stringify(allowed.during.tabs) === JSON.stringify(before.tabs), JSON.stringify(allowed.during.tabs));
  check("the redirect URL reaches the extension", allowed.result.ok?.includes("code=check-code&state=s3"), JSON.stringify(allowed.result));
  await sleep(1500);
  const afterAllow = await state();
  check("the sign-in window closes and the user's window and tabs stay", afterAllow.popupWindows === 0 && afterAllow.windows === 1 && JSON.stringify(afterAllow.tabs) === JSON.stringify(before.tabs), JSON.stringify(afterAllow));

  const cancelled = await signIn("s4", async (_, windowNumber) => {
    if (windowNumber) await app.eval(`return ac.engine.call("windows.dev", { window: ${windowNumber}, action: "performClose" })`);
  });
  check("closing the sign-in window rejects with Chrome's error", cancelled.result.error === "The user did not approve access.", JSON.stringify(cancelled.result));
  await sleep(1500);
  const afterCancel = await state();
  check("cancel leaves the user's window and tabs", afterCancel.popupWindows === 0 && afterCancel.windows === 1 && JSON.stringify(afterCancel.tabs) === JSON.stringify(before.tabs), JSON.stringify(afterCancel));

  await app.eval(`return ac.runCommand({ command: "newIncognitoWindow", arg: null, windowId: null })`);
  await until("the private window", async () => (await state()).windows === 2);
  const privateRun = await signIn("s5", async (target) => {
    if (!target) return;
    const page = await devtools(target);
    await page.eval(`document.getElementById("allow").click()`).catch(() => {});
    page.close();
  });
  check("with a private window open, sign-in still opens its own window and resolves", privateRun.during.popupWindows === 1 && privateRun.result.ok?.includes("state=s5"), JSON.stringify(privateRun.result));
  await sleep(1500);
  const afterPrivate = await state();
  check("both windows stay", afterPrivate.windows === 2 && afterPrivate.popupWindows === 0 && JSON.stringify(afterPrivate.tabs) === JSON.stringify(before.tabs), JSON.stringify(afterPrivate));

  const token = await run(`token(true)`, 30000);
  check("getAuthToken fails with an error, no crash", typeof token.error === "string" && !token.ok, JSON.stringify(token));
  check("the app is still up", app.stillOwned());

  const leftOpen = run(`flow(${JSON.stringify(`${origin}/signin?state=s6`)}, true)`, 60000).catch(() => null);
  await until("the sign-in page before relaunch", signinTarget).catch(() => null);
  await sleep(1500);
  const beforeQuit = await state();
  worker.close();
  await leftOpen;
  await app.quit();
  app = await launch(appArg, launchOpts);
  console.log(`      quit with ${beforeQuit.popupWindows} sign-in window(s) open, tabs ${JSON.stringify(beforeQuit.tabs)}`);
  const restored = await until("the restored session", async () => {
    const s = await state();
    return s.tabs.length >= 2 ? s : null;
  }, 30000).catch(async () => state());
  await sleep(1500);
  const relaunched = await state();
  check("relaunch restores the user's window and tabs, no sign-in window", relaunched.windows >= 1 && relaunched.popupWindows === 0 && JSON.stringify(relaunched.tabs) === JSON.stringify(before.tabs) && !(await signinTarget()), JSON.stringify({ restored, relaunched }));
} catch (e) {
  failed++;
  console.log(`FAIL  ${e.message}`);
} finally {
  await app.quit().catch(() => {});
  server.close();
}
process.exit(failed ? 1 : 0);
