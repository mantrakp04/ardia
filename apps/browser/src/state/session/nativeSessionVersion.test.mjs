import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the native launch reader expects the session.json version persist.ts writes", () => {
  const js = Number(read("./persist.ts").match(/const SESSION_VERSION = (\d+);/)[1]);
  const native = Number(read("../../../../../packages/ardiacore/ios/ArdiaSavedSession.mm").match(/\+ \(NSInteger\)version \{\s*return (\d+);/)[1]);
  assert.equal(native, js, "bump ArdiaSavedSession.version with SESSION_VERSION, and check the fields it reads still exist");
});

test("the native reader takes each field it reads from the shape of the file's own version", (t) => {
  const ios = fileURLToPath(new URL("../../../../../packages/ardiacore/ios/", import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), "saved-session-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const probe = join(dir, "probe");
  try {
    execFileSync("xcrun", ["clang++", "-std=c++20", "-fobjc-arc", "-framework", "Foundation", "-I", ios, "-w", fileURLToPath(new URL("./fixtures/savedSessionProbe.mm", import.meta.url)), join(ios, "ArdiaSavedSession.mm"), join(ios, "ArdiaSavedDocument.mm"), "-o", probe]);
  } catch (error) {
    if (error.code === "ENOENT") return t.skip("no clang here");
    throw error;
  }
  const out = execFileSync(probe, [join(dir, "docs")], { encoding: "utf8" });
  assert.doesNotMatch(out, /^FAIL/m, out);
  assert.match(out, /a version 6 file reads pin/);
});
