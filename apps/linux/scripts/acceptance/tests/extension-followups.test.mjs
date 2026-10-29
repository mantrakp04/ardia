import assert from "node:assert/strict";
import { access, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { launchArdia } from "../lib/ardia.mjs";
import { evaluate } from "../lib/cdp.mjs";
import { until } from "../lib/util.mjs";
import { unpackedExtensionId } from "../lib/crx.mjs";
import { e97, e98, e100 } from "../scenarios/e-extension-followups.mjs";
import { ACTION_SHORTCUT, COMMAND_SHORTCUT, ECHO_HOST_SOURCE, FOLLOWUP_EXTENSION, FOLLOWUP_NAME, SEARCH_KEYWORD, followupOf, installEchoHost, prepareFollowupExtension, sendNative } from "../scenarios/e-extension-followups.mjs";

describe("extension follow-up fixture", () => {
  it("declares a search provider, both shortcut kinds and native messaging, with no comments", async () => {
    const manifest = JSON.parse(await readFile(new URL("manifest.json", FOLLOWUP_EXTENSION), "utf8"));
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.name, FOLLOWUP_NAME);
    assert.equal(manifest.chrome_settings_overrides.search_provider.keyword, SEARCH_KEYWORD);
    assert.equal(manifest.chrome_settings_overrides.search_provider.is_default, false);
    assert.equal(manifest.commands._execute_action.suggested_key.default, ACTION_SHORTCUT);
    assert.equal(manifest.commands["fixture-command"].suggested_key.default, COMMAND_SHORTCUT);
    assert.ok(manifest.permissions.includes("nativeMessaging"));
    for (const name of await readdir(FOLLOWUP_EXTENSION)) {
      const text = await readFile(new URL(name, FOLLOWUP_EXTENSION), "utf8");
      assert.doesNotMatch(text, /(^|[^:])\/\/|\/\*|<!--/, `${name} has a comment`);
    }
    assert.doesNotMatch(ECHO_HOST_SOURCE, /(^|[^:])\/\/|\/\*/);
  });

  it("writes an echo host manifest that only allows the given extensions", async () => {
    const root = await mkdtemp(join(tmpdir(), "ardia-acceptance-echo-"));
    try {
      const file = await installEchoHost({ folder: join(root, "hosts"), scripts: join(root, "scripts"), name: "dev.ardia.acceptance.test", location: "chromium", extensionIds: ["b".repeat(32)] });
      const manifest = JSON.parse(await readFile(file, "utf8"));
      assert.equal(manifest.name, "dev.ardia.acceptance.test");
      assert.equal(manifest.type, "stdio");
      assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${"b".repeat(32)}/`]);
      await access(manifest.path, constants.X_OK);
      const launcher = await readFile(manifest.path, "utf8");
      assert.match(launcher, /^#!\/bin\/sh\n/);
      assert.match(launcher, /ARDIA_ECHO_LOCATION="chromium"/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("finds the fixture in an extensions.list reply and declares issues and manual steps", () => {
    assert.equal(followupOf({ ok: true, value: { extensions: [{ name: "Other" }, { name: FOLLOWUP_NAME, id: "x" }] } }).id, "x");
    assert.equal(followupOf({ ok: false }), null);
    assert.deepEqual([e97, e98, e100].map((s) => [s.id, s.issue]), [["E97", 97], ["E98", 98], ["E100", 100]]);
    for (const s of [e97, e98, e100]) assert.ok(s.manual.length && s.manual.every((m) => m.reason && m.steps.length), s.id);
  });
});

const CHROMIUM = process.env.ARDIA_ACCEPTANCE_CHROMIUM ?? "/usr/bin/chromium";
const available = await access(CHROMIUM, constants.X_OK).then(() => true, () => false);

describe("follow-up fixture in a stock Chromium", { skip: available ? false : `${CHROMIUM} is not installed`, timeout: 120000 }, () => {
  let root;
  let app;
  let worker;
  let id;
  before(async () => {
    root = await mkdtemp(join(tmpdir(), "ardia-acceptance-followups-chromium-"));
    const extension = await prepareFollowupExtension(join(root, "extension"));
    const extensionHost = await unpackedExtensionId(extension);
    app = await launchArdia({ executable: CHROMIUM, scratch: join(root, "profile"), label: "chromium-followups", extensions: true, extraArgs: [`--load-extension=${extension}`, "about:blank"] });
    const target = await until(async () => (await app.targets()).find((t) => t.type === "service_worker" && t.url === `chrome-extension://${extensionHost}/background.js`) ?? false, { timeout: 30000, label: "follow-up service worker" });
    id = new URL(target.url).host;
    worker = await app.connect(target);
  });
  after(async () => {
    await app?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("round-trips a native message through the generated echo host in the profile's own folder", async () => {
    await installEchoHost({ folder: join(root, "profile", "NativeMessagingHosts"), scripts: join(root, "scripts"), name: "dev.ardia.acceptance.echo", location: "profile", extensionIds: [id] });
    const result = await sendNative(worker, "dev.ardia.acceptance.echo", { ping: "hello" });
    assert.deepEqual(result, { ok: true, reply: { echo: { ping: "hello" }, location: "profile", origin: `chrome-extension://${id}/` } });
    await installEchoHost({ folder: join(root, "profile", "NativeMessagingHosts"), scripts: join(root, "scripts"), name: "dev.ardia.acceptance.other", location: "profile", extensionIds: ["a".repeat(32)] });
    const forbidden = await sendNative(worker, "dev.ardia.acceptance.other", { ping: 1 });
    assert.equal(forbidden.ok, false);
    assert.match(forbidden.error, /forbidden/i);
    const missing = await sendNative(worker, "dev.ardia.acceptance.missing", { ping: 1 });
    assert.match(missing.error, /not found/i);
  });

  it("gets both suggested shortcuts assigned by Chromium", async () => {
    const commands = await evaluate(worker, "chrome.commands.getAll()");
    const shortcut = (name) => commands.find((c) => c.name === name)?.shortcut;
    assert.equal(shortcut("_execute_action"), ACTION_SHORTCUT);
    assert.equal(shortcut("fixture-command"), COMMAND_SHORTCUT);
  });
});
