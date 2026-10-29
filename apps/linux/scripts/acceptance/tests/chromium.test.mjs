import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { launchArdia, Shell } from "../lib/ardia.mjs";
import { evaluate } from "../lib/cdp.mjs";
import { startFixtures, SUGGEST_HOST, suggestionsFor } from "../lib/fixtures.mjs";
import { writeChromePreferences } from "../lib/seed.mjs";
import { generateTls } from "../lib/tls.mjs";
import { dispatchDrop, dropElements, sidebarDropPoint } from "../lib/ui.mjs";
import { until } from "../lib/util.mjs";

const CHROMIUM = process.env.ARDIA_ACCEPTANCE_CHROMIUM ?? "/usr/bin/chromium";
const available = await access(CHROMIUM, constants.X_OK).then(() => true, () => false);

describe("harness against a stock Chromium", { skip: available ? false : `${CHROMIUM} is not installed`, timeout: 240000 }, () => {
  let root;
  let fixtures;
  let app;
  let downloads;

  before(async () => {
    root = await mkdtemp(join(tmpdir(), "ardia-acceptance-self-"));
    const tls = await generateTls(join(root, "tls"));
    fixtures = await startFixtures({ tls, slowInterval: 50 });
    const scratch = join(root, "profile");
    downloads = join(root, "downloads");
    await mkdir(downloads, { recursive: true });
    await writeChromePreferences(scratch, { downloads, printToPdf: true });
    app = await launchArdia({ executable: CHROMIUM, scratch, background: false, label: "chromium", extraArgs: [...fixtures.chromiumArgs, "--kiosk-printing", "about:blank"] });
  });

  after(async () => {
    await app?.close();
    await fixtures?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function open(url) {
    const { targetId } = await app.browser.send("Target.createTarget", { url: "about:blank" });
    const target = await until(async () => (await app.targets()).find((t) => t.id === targetId), { timeout: 5000, label: "new target" });
    const session = await app.connect(target);
    await session.send("Page.enable");
    await session.send("Security.enable");
    const states = [];
    session.on("Security.visibleSecurityStateChanged", ({ visibleSecurityState }) => states.push(visibleSecurityState));
    const loaded = session.waitFor("Page.loadEventFired", () => true, 15000);
    const navigation = await session.send("Page.navigate", { url });
    if (!navigation.errorText) await loaded.catch(() => {});
    return { session, navigation, states, targetId };
  }

  const lastState = async (states) => until(() => states.at(-1), { timeout: 5000, label: "security state" });

  it("trusts the generated certificate only through the SPKI list", async () => {
    const secure = await open(fixtures.url.secure());
    assert.equal(await evaluate(secure.session, "document.title"), "Secure fixture");
    assert.equal((await lastState(secure.states)).securityState, "secure");
    const bad = await open(fixtures.url.badcert());
    assert.notEqual(await evaluate(bad.session, "document.title").catch(() => ""), "Bad certificate fixture");
    const state = await lastState(bad.states);
    assert.match(state.securityState, /^insecure/);
    assert.ok(state.certificateSecurityState?.certificateNetworkError || state.securityStateIssueIds?.length, JSON.stringify(state));
  });

  it("serves HTTP as not secure and the mixed page as containing an insecure form", async () => {
    const plain = await open(fixtures.url.insecure());
    assert.equal(await evaluate(plain.session, "location.protocol"), "http:");
    assert.notEqual((await lastState(plain.states)).securityState, "secure");
    const mixed = await open(fixtures.url.mixed());
    const state = await until(() => mixed.states.find((s) => s.securityStateIssueIds?.includes("contained-mixed-form")), { timeout: 8000, label: "mixed form state" });
    assert.ok(state, "Chromium did not report the insecure form that Ardia classifies as mixed");
  });

  it("answers the mapped suggestion host and blocks every other host", async () => {
    const query = "harness";
    const page = await open(`https://${SUGGEST_HOST}/complete/search?client=firefox&q=${query}`);
    const body = JSON.parse(await evaluate(page.session, "document.body.innerText"));
    assert.deepEqual(body, [query, suggestionsFor(query)]);
    assert.equal((await lastState(page.states)).securityState, "secure");
    const blocked = await open("https://example.com/");
    assert.match(blocked.navigation.errorText ?? "", /NAME_NOT_RESOLVED/);
  });

  it("streams a gated slow download and finishes it on release", async () => {
    const dir = join(root, "cdp-downloads");
    await app.browser.send("Browser.setDownloadBehavior", { behavior: "allowAndName", downloadPath: dir, eventsEnabled: true });
    const progress = [];
    const off = app.browser.on("Browser.downloadProgress", (event) => progress.push(event));
    const page = await open(fixtures.url.page(1, "download"));
    const name = `gated-${Date.now()}.bin`;
    await page.session.send("Page.navigate", { url: fixtures.url.slow(name, 1 << 20) }).catch(() => {});
    const growing = await until(() => progress.find((p) => p.state === "inProgress" && p.receivedBytes > 0), { timeout: 15000, label: "download progress" });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.ok(!progress.some((p) => p.guid === growing.guid && p.state === "completed"), "the gated download finished before release");
    fixtures.release(name);
    const done = await until(() => progress.find((p) => p.guid === growing.guid && p.state === "completed"), { timeout: 20000, label: "download completion" });
    off();
    assert.equal((await stat(join(dir, done.guid))).size, 1 << 20);
    await app.browser.send("Browser.setDownloadBehavior", { behavior: "default" });
  });

  it("finds drop targets and delivers synthesized URL drops", async () => {
    const page = await open(fixtures.url.page(2, "drop"));
    await evaluate(page.session, `(() => {
      document.body.style.margin = '0';
      const area = document.createElement('div');
      area.style.cssText = 'position:fixed;left:0;top:0;width:200px;height:600px';
      area.addEventListener('dragover', e => e.preventDefault());
      area.addEventListener('drop', e => { e.preventDefault(); window.dropped = { uri: e.dataTransfer.getData('text/uri-list'), files: [...e.dataTransfer.files].map(f => f.name) }; });
      document.body.appendChild(area);
      return true;
    })()`);
    const shell = new Shell(app, { target: { id: page.targetId }, session: page.session, windowId: "self-test" });
    const areas = await dropElements(shell);
    const point = sidebarDropPoint(areas, await evaluate(page.session, "innerWidth"));
    assert.ok(point, JSON.stringify(areas));
    const url = fixtures.url.page(3, "dropped");
    await dispatchDrop(shell, point, { items: [{ mimeType: "text/uri-list", data: url }] });
    const dropped = await until(() => evaluate(page.session, "window.dropped"), { timeout: 5000, label: "drop event" });
    assert.equal(dropped.uri, url);
  });

  it("clicks by visible text and reports console problems logged before attach", async () => {
    const page = await open(fixtures.url.page(4, "click"));
    await evaluate(page.session, `(() => { const b = document.createElement('button'); b.textContent = 'Press here'; b.style.cssText = 'position:fixed;left:300px;top:300px;width:120px;height:40px'; b.onclick = () => window.pressed = (window.pressed ?? 0) + 1; document.body.appendChild(b); console.error('early problem'); return true; })()`);
    const target = (await app.targets()).find((t) => t.id === page.targetId);
    await page.session.close();
    app.connections.delete(target.id);
    const session = await app.connect(target);
    await session.send("Page.bringToFront");
    const shell = new Shell(app, { target, session, windowId: "self-test" });
    await shell.clickText("Press here");
    assert.equal(await until(() => shell.eval("window.pressed"), { timeout: 5000, label: "click" }), 1);
    assert.ok(shell.problems.some((p) => p.text?.includes("early problem")), JSON.stringify(shell.problems));
  });

  it("saves a kiosk print as a PDF in the seeded download folder", async () => {
    const page = await open(fixtures.url.print());
    await evaluate(page.session, "setTimeout(() => window.print(), 10), true");
    const pdfs = await until(async () => (await readdir(downloads)).filter((n) => n.endsWith(".pdf")).length ? (await readdir(downloads)).filter((n) => n.endsWith(".pdf")) : false, { timeout: 90000, label: "kiosk PDF" });
    assert.ok(pdfs.length >= 1);
  });

  it("closes the browser and its process group", async () => {
    const pid = app.child.pid;
    assert.equal(await app.close(), true);
    assert.throws(() => process.kill(-pid, 0));
    app = null;
  });
});
