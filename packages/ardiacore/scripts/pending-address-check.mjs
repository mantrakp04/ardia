#!/usr/bin/env node
import { rmSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { devtools, launch, session, sleep } from "../../../scripts/lib/instance.mjs";

const [appArg, scratchArg] = process.argv.slice(2);
if (!appArg || appArg === "-h" || appArg === "--help") {
  console.error("usage: pending-address-check.mjs <Ardia.app> [scratch dir]\nA tab a link opened keeps its pending address while the ardia command looks up its DevTools target.");
  process.exit(appArg ? 0 : 64);
}
const scratch = resolve(scratchArg ?? join(process.env.TMPDIR ?? "/tmp", `ac-pending-address-${process.pid}`));
rmSync(scratch, { recursive: true, force: true });

const SLOW_MS = 8000;
const server = createServer((req, res) => {
  res.setHeader("content-type", "text/html");
  if (req.url === "/slow") return void setTimeout(() => res.end("<!doctype html><title>Slow page</title><p>slow</p>"), SLOW_MS);
  res.end('<!doctype html><title>Opener</title><a id="link" target="_blank" href="/slow" style="display:block;width:200px;height:40px">slow</a>');
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const slowUrl = `${base}/slow`;

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const until = async (what, fn, ms = 10000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) {
    const v = await fn().catch(() => null);
    if (v) return v;
  }
  throw new Error(`timed out waiting for ${what}`);
};

const app = await launch(appArg, {
  data: join(scratch, "data"), js: process.env.JS ?? "pinned", onboarded: true,
  session: session({ settings: { newTabLinksOpenIn: "tab" } }),
});
try {
  const slowTab = () => app.eval(`const t = Object.values(ac.store.getState().tabs).find((t) => t.url === ${JSON.stringify(slowUrl)} || (t.openerId && t.url === "about:blank")); return t ? { id: t.id, url: t.url, title: t.title } : null`);
  const lookup = (id) => app.eval(`return ac.engine.call("engine.cliTabTargets", { tabIds: [${JSON.stringify(id)}] }).then((r) => r[${JSON.stringify(id)}])`);
  await app.eval(`ac.actions.openUrls([${JSON.stringify(`${base}/opener`)}]); return true`);
  const opener = await until("the opener page", async () => (await app.targets()).find((t) => t.type === "page" && t.url === `${base}/opener`));
  const page = await devtools(opener);
  await page.send("Page.bringToFront");
  await until("the opener visible", async () => (await page.send("Runtime.evaluate", { expression: "document.visibilityState === 'visible' && innerWidth > 0", returnByValue: true })).result.value);
  for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, x: 50, y: 20, button: "left", clickCount: 1 });
  page.close();
  const opened = await until("the tab the link opened", slowTab, 5000);
  check("the link's tab shows its pending address", opened.url === slowUrl, opened.url);
  await sleep(700);
  const during = await lookup(opened.id);
  check("a lookup while the first page loads answers no target", during?.targetId === null, JSON.stringify(during));
  await sleep(2500);
  const after = await slowTab();
  check("the tab still shows its pending address after the lookup", after?.url === slowUrl, after?.url);
  const loaded = await until("the slow page loaded", async () => { const t = await slowTab(); return t?.title === "Slow page" ? t : null; }, SLOW_MS + 10000);
  const settled = await lookup(loaded.id);
  check("a lookup once the page committed names its target", typeof settled?.targetId === "string" && settled.targetId.length > 0, JSON.stringify(settled));
  check("the loaded tab shows its address", loaded.url === slowUrl, loaded.url);
} catch (e) {
  check("ran to the end", false, e.message);
} finally {
  await app.quit().catch(() => app.kill());
  server.close();
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
