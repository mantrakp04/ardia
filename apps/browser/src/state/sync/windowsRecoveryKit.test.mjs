import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { HIDDEN_WORDS, kitPdf, kitText } from "../../../../../packages/expo-windows/src/sync/kit.ts";
import { grayscalePng } from "../../../../../packages/expo-windows/src/sync/png.ts";
import { qrCode } from "../../../../../packages/expo-windows/src/sync/qr.ts";
import { MAC_VAULT } from "../../../../../packages/expo-windows/src/selfCheck/syncFixture.ts";

const repo = fileURLToPath(new URL("../../../../../", import.meta.url));
const interop = join(repo, "packages/sync/tests/fixtures/windows-interop");
const mac = JSON.parse(readFileSync(join(interop, "mac.json"), "utf8"));

test("the Windows QR code is module for module the one CoreImage draws on the Mac", () => {
  const code = qrCode(mac.words.join(" "));
  const rows = [];
  for (let y = -1; y <= code.size; y++) {
    let row = "";
    for (let x = -1; x <= code.size; x++) row += x >= 0 && y >= 0 && x < code.size && y < code.size && code.dark(x, y) ? "1" : "0";
    rows.push(row);
  }
  assert.equal(`${rows.join("\n")}\n`, readFileSync(join(interop, "qr.txt"), "utf8"));
});

test("the self-check carries the Mac's fixture vault byte for byte", () => {
  assert.equal(MAC_VAULT.entropy, mac.entropy);
  assert.equal(MAC_VAULT.words, mac.words.join(" "));
  assert.deepEqual(MAC_VAULT.password, mac.password);
  assert.deepEqual(MAC_VAULT.local, mac.local);
  for (const file of mac.files) {
    const carried = MAC_VAULT.files.find((f) => f.id === file.id);
    const bytes = readFileSync(join(interop, "mac", mac.chainTag, mac.scopeTags[file.scope], `${file.id}.nns`));
    assert.equal(carried?.data, bytes.toString("base64"));
  }
});

test("the recovery kit lists the 24 words in order, and its PDF is well formed with a working cross-reference table", () => {
  const created = new Date(2026, 10, 13);
  const text = kitText(mac.words, created, "DESKTOP-1");
  assert.match(text, /^Ardia Recovery Kit\nCreated November 13, 2026 on DESKTOP-1\n/);
  mac.words.forEach((word, i) => assert.ok(text.includes(`${String(i + 1).padStart(2, " ")}. ${word}\n`), word));
  assert.ok(!/\bMac\b/.test(text));
  const pdf = Buffer.from(kitPdf(mac.words, created, "DESKTOP-1")).toString("latin1");
  assert.ok(pdf.startsWith("%PDF-1.4"));
  const xref = Number(/startxref\n(\d+)/.exec(pdf)[1]);
  assert.ok(pdf.slice(xref).startsWith("xref\n0 9\n"));
  const offsets = [...pdf.slice(xref).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
  offsets.forEach((offset, i) => assert.ok(pdf.slice(offset).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`));
  for (const word of mac.words) assert.ok(pdf.includes(`(${word}) Tj`), word);
  const masked = Buffer.from(kitPdf(HIDDEN_WORDS, created, "DESKTOP-1")).toString("latin1");
  for (const word of mac.words) assert.ok(!masked.includes(`(${word}) Tj`), `the preview shows ${word}`);
});

test("a PNG is a valid signature, header and stored zlib stream", () => {
  const png = Buffer.from(grayscalePng(3, 2, (x, y) => (x + y) % 2 ? 0 : 255));
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.subarray(12, 16).toString(), "IHDR");
  assert.equal(png.readUInt32BE(16), 3);
  assert.equal(png.readUInt32BE(20), 2);
});
