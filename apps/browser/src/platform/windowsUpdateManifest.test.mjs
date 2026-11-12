import assert from "node:assert/strict";
import { test } from "node:test";
import { failureText, folderOf, megabytes, offered, readBuild, readManifest } from "../../../../packages/expo-windows/src/updater/manifest.ts";

const under = "https://github.com/ardia-browser/ardia/releases/download/";
const sha = "a".repeat(64);
const installer = (name) => ({ url: `${under}windows-alpha/${name}`, sha256: sha, bytes: 180_000_000 });
const manifest = (changes = {}) => JSON.stringify({ version: "0.2.46", build: 60, x64: installer("Ardia-Setup-x64.exe"), arm64: installer("Ardia-Setup-arm64.exe"), ...changes });

test("a published manifest reads with both installers", () => {
  const read = readManifest(manifest(), under);
  assert.equal(read.build, 60);
  assert.equal(read.version, "0.2.46");
  assert.equal(read.installers.x64.url, `${under}windows-alpha/Ardia-Setup-x64.exe`);
  assert.equal(read.installers.arm64.bytes, 180_000_000);
});

test("a manifest that is not JSON, not an object, or has no usable build is refused", () => {
  for (const text of ["", "<html>", "[]", "null", JSON.stringify({ version: "1" }), manifest({ build: 0 }), manifest({ build: 1.5 }), manifest({ build: "60" }), manifest({ version: "" }), manifest({ version: "a b" })]) {
    assert.equal(readManifest(text, under), null, text);
  }
});

test("an installer from another address, with another ending, or a path that climbs is dropped", () => {
  const dropped = [
    { ...installer("Ardia-Setup-x64.exe"), url: "https://example.com/Ardia-Setup-x64.exe" },
    { ...installer("Ardia-Setup-x64.exe"), url: `http://github.com/ardia-browser/ardia/releases/download/windows-alpha/Ardia-Setup-x64.exe` },
    { ...installer("Ardia-Setup-x64.exe"), url: `${under}windows-alpha/Ardia-Setup-x64.msi` },
    { ...installer("Ardia-Setup-x64.exe"), url: `${under}../../../other/repo/releases/download/x/Setup.exe` },
    { ...installer("Ardia-Setup-x64.exe"), url: `${under}windows-alpha/Ardia Setup.exe` },
    { ...installer("Ardia-Setup-x64.exe"), sha256: sha.toUpperCase() },
    { ...installer("Ardia-Setup-x64.exe"), sha256: "abc" },
    { ...installer("Ardia-Setup-x64.exe"), bytes: 0 },
    { ...installer("Ardia-Setup-x64.exe"), bytes: 2 ** 31 },
    { ...installer("Ardia-Setup-x64.exe"), bytes: "180000000" },
    "Ardia-Setup-x64.exe",
  ];
  for (const x64 of dropped) {
    const read = readManifest(manifest({ x64 }), under);
    assert.equal(read.installers.x64, undefined, JSON.stringify(x64));
    assert.ok(read.installers.arm64);
  }
});

test("only a higher build with an installer for this processor is offered", () => {
  const read = readManifest(manifest(), under);
  assert.equal(offered(read, "x64", 59).url, `${under}windows-alpha/Ardia-Setup-x64.exe`);
  assert.equal(offered(read, "arm64", 1).url, `${under}windows-alpha/Ardia-Setup-arm64.exe`);
  assert.equal(offered(read, "x64", 60), null);
  assert.equal(offered(read, "x64", 61), null);
  assert.equal(offered(read, "x86", 1), null);
  assert.equal(offered(read, "__proto__", 1), null);
  assert.equal(offered(readManifest(manifest({ arm64: undefined }), under), "arm64", 1), null);
});

test("the build file beside the app reads, and anything else means no identity", () => {
  assert.deepEqual(readBuild('{"version":"0.2.46-nightly.5","build":57}'), { version: "0.2.46-nightly.5", build: 57 });
  for (const text of ["", "{}", '{"version":"0.2.46"}', '{"version":"0.2.46","build":-1}', '{"build":57}']) assert.equal(readBuild(text), null, text);
});

test("a test feed's installers must sit in the feed's own folder", () => {
  const feed = "http://10.0.2.2:18770/feed/windows-update.json";
  assert.equal(folderOf(feed), "http://10.0.2.2:18770/feed/");
  const local = { url: "http://10.0.2.2:18770/feed/Ardia-Setup-arm64.exe", sha256: sha, bytes: 10 };
  assert.ok(readManifest(manifest({ arm64: local }), folderOf(feed)).installers.arm64);
  assert.equal(readManifest(manifest({ arm64: installer("Ardia-Setup-arm64.exe") }), folderOf(feed)).installers.arm64, undefined);
});

test("a failed check is told in words, whatever shape the failure has", () => {
  assert.equal(failureText(new Error("the server answered 404")), "the server answered 404");
  assert.equal(failureText({ message: "the server answered 404", code: "EUNSPECIFIED" }), "the server answered 404");
  assert.equal(failureText("no answer"), "no answer");
  for (const odd of [{}, { message: 5 }, null, undefined, 7, ""]) assert.equal(failureText(odd), "the check failed");
});

test("sizes are shown in whole megabytes, never zero", () => {
  assert.equal(megabytes(180_000_000), 172);
  assert.equal(megabytes(10), 1);
});
