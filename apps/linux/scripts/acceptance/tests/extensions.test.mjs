import assert from "node:assert/strict";
import { access, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { after, before, describe, it } from "node:test";
import { launchArdia } from "../lib/ardia.mjs";
import { evaluate } from "../lib/cdp.mjs";
import { until } from "../lib/util.mjs";
import { unpackedExtensionId } from "../lib/crx.mjs";
import f09, { FIXTURE_EXTENSION, FIXTURE_NAME, fixtureIcon, listed, prepareExtension, setVersion } from "../scenarios/f09-extensions.mjs";

describe("F09 extension fixture", () => {
  let root;
  before(async () => { root = await mkdtemp(join(tmpdir(), "ardia-acceptance-extension-")); });
  after(() => rm(root, { recursive: true, force: true }));

  it("ships an MV3 extension with an action popup, a side panel, an omnibox keyword and no comments", async () => {
    const manifest = JSON.parse(await readFile(new URL("manifest.json", FIXTURE_EXTENSION), "utf8"));
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.name, FIXTURE_NAME);
    assert.equal(manifest.action.default_popup, "popup.html");
    assert.equal(manifest.side_panel.default_path, "panel.html");
    assert.equal(manifest.omnibox.keyword, "ardiafixture");
    assert.ok(manifest.permissions.includes("sidePanel"));
    for (const name of await readdir(FIXTURE_EXTENSION)) {
      const text = await readFile(new URL(name, FIXTURE_EXTENSION), "utf8");
      assert.doesNotMatch(text, /(^|[^:])\/\/|\/\*|<!--/, `${name} has a comment`);
    }
  });

  it("writes a valid PNG icon", () => {
    const png = fixtureIcon(16, [1, 2, 3, 255]);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.toString("ascii", 12, 16), "IHDR");
    assert.equal(png.readUInt32BE(16), 16);
    const idat = png.indexOf("IDAT");
    const length = png.readUInt32BE(idat - 4);
    const rows = inflateSync(png.subarray(idat + 4, idat + 4 + length));
    assert.equal(rows.length, 16 * (1 + 16 * 4));
    assert.deepEqual([...rows.subarray(1, 5)], [1, 2, 3, 255]);
  });

  it("copies the fixture into a scratch folder and edits its version for the reload check", async () => {
    const dir = await prepareExtension(join(root, "copy"));
    assert.ok((await readdir(dir)).includes("icon.png"));
    await setVersion(dir, "1.1");
    assert.equal(JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")).version, "1.1");
    const original = JSON.parse(await readFile(new URL("manifest.json", FIXTURE_EXTENSION), "utf8"));
    assert.equal(original.version, "1.0");
  });

  it("finds the fixture in an extensions.list reply and declares its manual steps", () => {
    assert.equal(listed({ ok: true, value: { extensions: [{ name: "Other" }, { name: FIXTURE_NAME, id: "x" }] } }).id, "x");
    assert.equal(listed({ ok: false }), null);
    assert.equal(f09.issue, 19);
    assert.ok(f09.manual.length >= 3 && f09.manual.every((m) => m.reason && m.steps.length));
  });
});

const CHROMIUM = process.env.ARDIA_ACCEPTANCE_CHROMIUM ?? "/usr/bin/chromium";
const available = await access(CHROMIUM, constants.X_OK).then(() => true, () => false);

describe("F09 fixture in a stock Chromium", { skip: available ? false : `${CHROMIUM} is not installed`, timeout: 120000 }, () => {
  let root;
  let app;
  let extensionHost;
  before(async () => {
    root = await mkdtemp(join(tmpdir(), "ardia-acceptance-extension-chromium-"));
    const extension = await prepareExtension(join(root, "extension"));
    extensionHost = await unpackedExtensionId(extension);
    app = await launchArdia({ executable: CHROMIUM, scratch: join(root, "profile"), label: "chromium-extension", extensions: true, extraArgs: [`--load-extension=${extension}`, "about:blank"] });
  });
  after(async () => {
    await app?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("loads with --load-extension and keeps a badge on the tab it was set for", async () => {
    const target = await until(async () => (await app.targets()).find((t) => t.type === "service_worker" && t.url === `chrome-extension://${extensionHost}/background.js`) ?? false, { timeout: 30000, label: "fixture service worker" });
    const worker = await app.connect(target);
    const manifest = await evaluate(worker, "chrome.runtime.getManifest()");
    assert.equal(manifest.side_panel.default_path, "panel.html");
    const second = await app.browser.send("Target.createTarget", { url: "about:blank#b" });
    await until(() => evaluate(worker, `chrome.tabs.query({}).then((tabs) => tabs.length === 2 && tabs.every((tab) => tab.status === "complete" && tab.url) && tabs.some((tab) => tab.url.endsWith("#b")))`), { timeout: 30000, label: "both fixture tabs committed" });
    const badges = await evaluate(worker, `chrome.tabs.query({}).then(async (tabs) => {
      const a = tabs.find((tab) => !tab.url.endsWith("#b"));
      const b = tabs.find((tab) => tab.url.endsWith("#b"));
      await chrome.action.setBadgeText({ tabId: a.id, text: "7" });
      return [await chrome.action.getBadgeText({ tabId: a.id }), await chrome.action.getBadgeText({ tabId: b.id })];
    })`);
    assert.deepEqual(badges, ["7", ""]);
    assert.equal(await evaluate(worker, "chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).then(() => chrome.sidePanel.getPanelBehavior()).then((b) => b.openPanelOnActionClick)"), true);
    await app.browser.send("Target.closeTarget", { targetId: second.targetId });
  });
});
