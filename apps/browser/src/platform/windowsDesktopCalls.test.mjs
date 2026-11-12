import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { domainCall } from "../../../../packages/expo-windows/src/engine/domains/tables.ts";
import { sha256 } from "../../../../packages/expo-windows/src/engine/domains/sha256.ts";
import { idForKey, insideFolder, withoutComments } from "../../../../packages/expo-windows/src/engine/domains/unpacked.ts";
import { systemStateOf } from "../../../../packages/expo-windows/src/engine/domains/systemState.ts";

const rows = JSON.parse(readFileSync(new URL("../../../../packages/expo-windows/src/engine/domains/forwarded.json", import.meta.url), "utf8"));
const FOLDER = "C:\\Users\\tester\\Extensions\\sample";
const LINE_NOTE = `${"/".repeat(2)} a note Chrome allows`;
const BLOCK_NOTE = `${"/"}${"*"} gone ${"*"}${"/"}`;

function fakeEngine({ saved = null, picked = null, files = {}, power = null, replies = {} } = {}) {
  const engine = {
    calls: [],
    events: [],
    ticks: [],
    reading: power,
    call: async (name, profile, argsJson) => {
      engine.calls.push({ name, profile, args: JSON.parse(argsJson) });
      return JSON.stringify(replies[name] ?? {});
    },
    host: async () => ({}),
    profileDataFolder: () => null,
    removeProfileFolder: async () => "unsupported",
    emit: (name, data) => engine.events.push({ name, data }),
    missing: async () => "null",
    desktop: {
      saveFile: async (request) => {
        engine.saveRequests = [...(engine.saveRequests ?? []), request];
        return saved;
      },
      pickFolder: async () => picked,
      readText: async (path) => (typeof files[path] === "string" ? files[path] : null),
      readBase64: async (path) => (files[path] instanceof Buffer ? files[path].toString("base64") : null),
      power: () => engine.reading,
      every: (_ms, run) => engine.ticks.push(run),
    },
  };
  return engine;
}

const calling = (engine, domain) => async (verb, args = {}, profile = "Ardia p-1") => JSON.parse(await domainCall(rows, engine, domain)(verb, profile, JSON.stringify(args)));

test("bookmarks export asks where to save and hands the engine that Windows path", async () => {
  const engine = fakeEngine({ saved: "C:\\Users\\tester\\Ardia Bookmarks.html" });
  assert.equal(await calling(engine, "bookmarks")("exportHtml"), "C:\\Users\\tester\\Ardia Bookmarks.html");
  assert.deepEqual(engine.calls, [{ name: "ac_bookmarks_export_html", profile: "Ardia p-1", args: { path: "C:\\Users\\tester\\Ardia Bookmarks.html" } }]);
  assert.equal(engine.saveRequests[0].extension, "html");
  const cancelled = fakeEngine();
  assert.equal(await calling(cancelled, "bookmarks")("exportHtml"), null);
  assert.deepEqual(cancelled.calls, []);
});

test("password export warns in the save panel, and only a written file reports its path", async () => {
  const path = "\\\\nas\\backup\\Ardia Passwords.csv";
  const engine = fakeEngine({ saved: path, replies: { ac_passwords_export: { status: "succeeded" } } });
  assert.deepEqual(await calling(engine, "passwords")("export", {}, "incognito1@Ardia p-1"), { status: "succeeded", path });
  assert.deepEqual(engine.calls, [{ name: "ac_passwords_export", profile: "Ardia p-1", args: { path } }]);
  assert.match(engine.saveRequests[0].message, /Anyone who can open this file can read your passwords/);
  const refused = fakeEngine({ saved: path, replies: { ac_passwords_export: { status: "reauthFailed" } } });
  assert.deepEqual(await calling(refused, "passwords")("export"), { status: "reauthFailed" });
  assert.deepEqual(await calling(fakeEngine(), "passwords")("export"), { status: "cancelled" });
});

test("an unpacked folder reads as the Mac's install sheet", async () => {
  const key = randomBytes(64).toString("base64");
  const expectedId = [...createHash("sha256").update(Buffer.from(key, "base64")).digest().subarray(0, 16)].map((b) => String.fromCharCode(97 + (b >> 4), 97 + (b & 15))).join("");
  const icon = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const engine = fakeEngine({
    picked: FOLDER,
    files: {
      [`${FOLDER}\\manifest.json`]: `{
        ${LINE_NOTE}
        "manifest_version": 3, "name": "__MSG_appName__", "version": "1.0.2", "description": "Plain words",
        "default_locale": "en", "key": "${key}",
        "icons": { "16": "icons/16.png", "128": "icons/128.png", "48": "icons/48.png" },
        "action": { "default_title": "__MSG_ACTIONTITLE__", "default_popup": "popup.html" },
        "permissions": ["storage", "<all_urls>"], "host_permissions": ["https://a.example/*"],
        "content_scripts": [{ "matches": ["https://a.example/*", "https://b.example/*"] }],
        "options_ui": { "page": "options.html" },
      }`,
      [`${FOLDER}\\_locales\\en\\messages.json`]: '{ "appName": { "message": "Sample Tools" }, "actionTitle": { "message": "Open Sample" } }',
      [`${FOLDER}\\icons\\128.png`]: icon,
      [`${FOLDER}\\icons\\48.png`]: icon,
    },
  });
  const extensions = calling(engine, "extensions");
  assert.equal(await extensions("chooseFolder"), FOLDER);
  const sheet = await extensions("inspectUnpacked", { path: FOLDER });
  assert.deepEqual(sheet, {
    name: "Sample Tools",
    version: "1.0.2",
    description: "Plain words",
    manifestVersion: 3,
    icon: `data:image/png;base64,${icon.toString("base64")}`,
    permissions: ["storage"],
    optionalPermissions: [],
    hostPermissions: ["<all_urls>", "https://a.example/*", "https://b.example/*"],
    hasAction: true,
    popup: "popup.html",
    actionTitle: "Open Sample",
    actionIcon: `data:image/png;base64,${icon.toString("base64")}`,
    optionsPage: "options.html",
    incognitoSplit: false,
    id: expectedId,
    path: FOLDER,
  });
  assert.equal(idForKey(key), expectedId);
  await assert.rejects(extensions("inspectUnpacked", { path: "C:\\empty" }), { message: "Manifest file is missing or unreadable" });
});

test("a manifest's icon can't reach outside its folder", () => {
  assert.equal(insideFolder("../secret.png"), undefined);
  assert.equal(insideFolder("C:/Windows/x.png"), undefined);
  assert.equal(insideFolder("/icons//a.png"), "icons/a.png");
  const kept = `{"a": "${"/".repeat(2)} kept", `;
  assert.equal(withoutComments(`${kept}${BLOCK_NOTE} "b": [1, 2,],}`), `${kept} "b": [1, 2]}`);
});

test("the SHA-256 the extension id uses matches Node's", () => {
  for (const size of [0, 1, 55, 56, 63, 64, 65, 1000]) {
    const data = randomBytes(size);
    assert.equal(Buffer.from(sha256(new Uint8Array(data))).toString("hex"), createHash("sha256").update(data).digest("hex"), `size ${size}`);
  }
});

test("Windows' power reading becomes the Mac's system state, and a change is sent once", async () => {
  assert.deepEqual(systemStateOf({ onBattery: true, batteryPercent: 42, batterySaver: true, memoryLoad: 90, physicalMemory: 8e9 }), {
    onBattery: true,
    batteryLevel: 0.42,
    lowPowerMode: true,
    memoryPressure: "warning",
    physicalMemory: 8e9,
  });
  assert.deepEqual(systemStateOf(null), { onBattery: false, batteryLevel: null, lowPowerMode: false, memoryPressure: "normal", physicalMemory: 0 });
  const engine = fakeEngine({ power: { onBattery: false, batteryPercent: null, batterySaver: false, memoryLoad: 40, physicalMemory: 16e9 } });
  const engineDomain = calling(engine, "engine");
  assert.equal((await engineDomain("systemState")).onBattery, false);
  await engineDomain("systemState");
  assert.equal(engine.ticks.length, 1, "one watcher however often it is asked");
  engine.ticks[0]();
  assert.deepEqual(engine.events, []);
  engine.reading = { ...engine.reading, onBattery: true, batteryPercent: 80 };
  engine.ticks[0]();
  engine.ticks[0]();
  assert.deepEqual(engine.events.map((e) => [e.name, e.data.onBattery, e.data.batteryLevel]), [["engine.systemState", true, 0.8]]);
});
