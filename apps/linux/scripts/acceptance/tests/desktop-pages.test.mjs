import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { inflateSync } from "node:zlib";
import { pcm16, rms, WIREPLUMBER_HEADLESS } from "../lib/desktopAudio.mjs";
import { colorDistance, differingFraction, fractionNear, hueDistance, hueOf, meanColor, parseHex, toHex, towards } from "../lib/desktopPixels.mjs";
import { ICON_COLOR, solidPng } from "../lib/pageFixtures.mjs";
import { popoverVerdict } from "../scenarios/d-gestures.mjs";
import { certificateFacts, compareCertificate, dockVerdict, panelFacts } from "../scenarios/d-pages.mjs";

const run = promisify(execFile);

function image(width, height, paint) {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(paint(x, y), (y * width + x) * 3);
  return { width, height, data };
}

test("colors convert between hex and channels and measure distance, hue and direction", () => {
  assert.deepEqual(parseHex("#22aa66"), [0x22, 0xaa, 0x66]);
  assert.equal(toHex([34, 170, 102]), "#22aa66");
  assert.equal(colorDistance([0, 0, 0], [10, 3, 200]), 200);
  assert.ok(hueDistance(hueOf(parseHex("#336699")), 210) < 1);
  assert.equal(hueOf([128, 128, 128]), null);
  assert.equal(towards([255, 255, 255], [0, 0, 0], [128, 128, 128]).toFixed(2), "0.50");
  assert.equal(towards([10, 10, 10], [10, 10, 10], [0, 0, 0]), 0);
});

test("region measures read only the given rectangle and clamp it to the image", () => {
  const half = image(10, 10, (x) => (x < 5 ? [255, 0, 0] : [0, 0, 255]));
  assert.deepEqual(meanColor(half, { x: 0, y: 0, width: 5, height: 10 }), [255, 0, 0]);
  assert.equal(fractionNear(half, { x: 0, y: 0, width: 10, height: 10 }, [255, 0, 0], 10), 0.5);
  assert.equal(fractionNear(half, { x: -5, y: -5, width: 10, height: 10 }, [255, 0, 0], 10), 1);
  const other = image(10, 10, () => [255, 0, 0]);
  assert.equal(differingFraction(half, other, { x: 0, y: 0, width: 10, height: 10 }), 0.5);
  assert.equal(meanColor(half, { x: 20, y: 20, width: 5, height: 5 }), null);
});

test("the null-sink level is the RMS of the captured PCM and silence is zero", () => {
  const buffer = Buffer.alloc(8);
  [1000, -1000, 1000, -1000].forEach((v, i) => buffer.writeInt16LE(v, i * 2));
  assert.deepEqual([...pcm16(buffer)], [1000, -1000, 1000, -1000]);
  assert.equal(rms(pcm16(buffer)), 1000);
  assert.equal(rms(new Int16Array(0)), 0);
  for (const monitor of ["monitor.alsa", "monitor.bluez", "monitor.v4l2"]) assert.match(WIREPLUMBER_HEADLESS, new RegExp(`${monitor.replace(".", "\\.")} = disabled`));
});

test("the favicon fixture is a valid solid PNG of the given size and color", () => {
  const png = solidPng(4, ICON_COLOR);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), 4);
  assert.equal(png.readUInt32BE(20), 4);
  const idatLength = png.readUInt32BE(33);
  assert.equal(png.subarray(37, 41).toString("ascii"), "IDAT");
  const rows = inflateSync(png.subarray(41, 41 + idatLength));
  assert.equal(rows.length, 4 * (1 + 4 * 3));
  assert.deepEqual([...rows.subarray(1, 4)], ICON_COLOR);
});

test("dock verdicts place the page and DevTools by dock side and reject a pane DevTools doesn't share", () => {
  const pane = { x: 100, y: 50, width: 800, height: 600 };
  const right = dockVerdict("right", { pane, size: { width: 500, height: 600 } });
  assert.deepEqual(right.problems, []);
  assert.deepEqual(right.tools, { x: 600, y: 50, width: 300, height: 600 });
  assert.equal(right.splitter.x, 600);
  const left = dockVerdict("left", { pane, size: { width: 500, height: 600 } });
  assert.deepEqual(left.page, { x: 400, y: 50, width: 500, height: 600 });
  assert.equal(left.splitter.x, 400);
  const bottom = dockVerdict("bottom", { pane, size: { width: 800, height: 400 } });
  assert.deepEqual(bottom.tools, { x: 100, y: 450, width: 800, height: 200 });
  assert.equal(dockVerdict("right", { pane, size: { width: 800, height: 600 } }).problems.length, 1);
  assert.equal(dockVerdict("bottom", { pane, size: { width: 700, height: 400 } }).problems.length, 1);
});

test("certificate details are compared field by field, the fingerprint by its shown prefix", () => {
  const served = certificateFacts({ subject: { CN: "secure.ardia.test", O: "Ardia Acceptance" }, issuer: { CN: "Ardia Acceptance Test CA" }, valid_from: "Oct 28 12:00:00 2026 GMT", valid_to: "Oct 30 12:00:00 2026 GMT", fingerprint256: "AB:30:D9:14:AE:7B:D0:0C:A5:27:59:D1:C3:BC:BD:F9:00:11" });
  const text = ["Issued to", served.issuedTo, "Organization", served.organization, "Issued by", served.issuedBy, "Valid from", served.validFrom, "Expires", served.expires, "SHA-256", "AB 30 D9 14 AE 7B D0 0C A5 27 59 D1 C3 BC BD F9…"].join("\n");
  const shown = panelFacts(text);
  assert.deepEqual(compareCertificate(served, shown), []);
  assert.equal(compareCertificate(served, { ...shown, issuedBy: "Someone else" }).length, 1);
  assert.equal(compareCertificate(served, { ...shown, sha256: "AB 30…" }).length, 1);
  assert.equal(compareCertificate(served, { ...shown, sha256: "FF 30 D9 14 AE 7B D0 0C…" }).length, 1);
});

test("a popover counts as drawn where the shell put it, and fails when the page around it is blanked", () => {
  const bar = { x: 60, y: 60, width: 160, height: 32 };
  const before = image(400, 200, () => [255, 255, 255]);
  const drawn = image(400, 200, (x, y) => (x >= 60 && x < 220 && y >= 60 && y < 92 ? [30, 30, 30] : [255, 255, 255]));
  assert.ok(popoverVerdict(before, drawn, bar).onScreen > 0.9);
  assert.ok(popoverVerdict(before, drawn, bar).around < 0.01);
  assert.ok(popoverVerdict(before, before, bar).onScreen < 0.01);
  const blanked = image(400, 200, (x, y) => (x >= 28 && x < 252 && y >= 28 && y < 124 ? [62, 62, 95] : [255, 255, 255]));
  assert.ok(popoverVerdict(before, blanked, bar).around > 0.9);
  assert.equal(popoverVerdict(before, drawn, { ...bar, y: 2 }).around, 0);
});

test("the portal backend returns the chosen save filter from the request's own filters", { skip: false, timeout: 30000 }, async (t) => {
  const has = await run("python3", ["-c", "import dbusmock, dbus"], { timeout: 10000 }).then(() => true, () => false);
  if (!has) return t.skip("needs python-dbusmock");
  const mocks = fileURLToPath(new URL("../lib/mocks/", import.meta.url));
  const script = `
import json, sys, dbus
sys.path.insert(0, ${JSON.stringify(mocks)})
import portal_backend as p
class Mock: pass
m = Mock()
m.ardia_calls = []
m.ardia_answers = {"SaveFile": [{"response": 0, "uris": ["file:///tmp/a.mhtml"], "filter": "Webpage, Single File"}]}
m.ardia_default = {"response": 1}
filters = dbus.Array([dbus.Struct((dbus.String("Webpage, HTML Only"), dbus.Array([dbus.Struct((dbus.UInt32(0), dbus.String("*.html")))]))), dbus.Struct((dbus.String("Webpage, Single File"), dbus.Array([dbus.Struct((dbus.UInt32(0), dbus.String("*.mhtml")))])))])
code, results = p._answer(m, "SaveFile", "/r", "", "", "Save", dbus.Dictionary({"filters": filters}, signature="sv"))
print(json.dumps({"code": int(code), "uris": [str(u) for u in results["uris"]], "filter": [str(results["current_filter"][0]), [[int(k), str(g)] for k, g in results["current_filter"][1]]], "recorded": m.ardia_calls[0]["method"]}))
`;
  const { stdout } = await run("python3", ["-c", script], { timeout: 20000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
  assert.deepEqual(JSON.parse(stdout), { code: 0, uris: ["file:///tmp/a.mhtml"], filter: ["Webpage, Single File", [[0, "*.mhtml"]]], recorded: "SaveFile" });
});
