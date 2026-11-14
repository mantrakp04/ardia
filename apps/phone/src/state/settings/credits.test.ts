import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { creditInputs, CREDITS_FILE, gradleArtifacts, importerBlock, nativeCredits, packageRoot, repositoryUrl } from "../../../test/credits.ts";

test("the licenses page was generated from the current lockfile and the module's Gradle libraries", () => {
  const credits = JSON.parse(readFileSync(CREDITS_FILE, "utf8"));
  assert.equal(credits.inputs, creditInputs(), "dependencies changed: bundle once, then run pnpm -C apps/phone credits <source map>");
  assert.ok(credits.packages.length > 0);
  for (const credit of [...credits.packages, ...credits.native]) {
    assert.ok(credit.name && credit.license && /^https?:\/\//.test(credit.url), JSON.stringify(credit));
  }
});

test("a bundled module path names its package, scoped or not", () => {
  assert.equal(packageRoot("/r/node_modules/.pnpm/react-native@0.81.6/node_modules/react-native/Libraries/A.js"), "/r/node_modules/.pnpm/react-native@0.81.6/node_modules/react-native");
  assert.equal(packageRoot("/r/node_modules/@babel/runtime/helpers/x.js"), "/r/node_modules/@babel/runtime");
  assert.equal(packageRoot("/r/packages/core/src/mobile.ts"), null);
});

test("a package's link comes from its repository, then its homepage, then npm", () => {
  assert.equal(repositoryUrl({ name: "a", repository: "git+https://github.com/x/a.git" }), "https://github.com/x/a");
  assert.equal(repositoryUrl({ name: "a", repository: { url: "git://github.com/x/a.git" } }), "https://github.com/x/a");
  assert.equal(repositoryUrl({ name: "a", repository: "x/a" }), "https://github.com/x/a");
  assert.equal(repositoryUrl({ name: "a", homepage: "https://a.dev" }), "https://a.dev");
  assert.equal(repositoryUrl({ name: "@s/a" }), "https://www.npmjs.com/package/@s/a");
});

test("every Gradle library the module adds needs a recorded license", () => {
  const gradle = 'dependencies {\n  implementation "androidx.core:core:1.16.0"\n  implementation "com.google.zxing:core:3.5.4"\n  implementation "com.facebook.react:react-android"\n}';
  assert.deepEqual(gradleArtifacts(gradle), ["androidx.core:core", "com.google.zxing:core", "com.facebook.react:react-android"]);
  assert.deepEqual(nativeCredits(gradleArtifacts(gradle)).map((credit) => credit.name), ["Android Jetpack (AndroidX)", "ZXing"]);
  assert.throws(() => nativeCredits(["io.unknown:thing"]), /no license recorded/);
});

test("the lockfile section for one app ends where the next begins", () => {
  const lockfile = "importers:\n\n  apps/a:\n    dependencies:\n      x: 1\n\n  apps/phone:\n    dependencies:\n      y: 2\n\n  packages/z:\n    dependencies: {}\n\npackages:\n";
  assert.equal(importerBlock(lockfile, "apps/phone"), "  apps/phone:\n    dependencies:\n      y: 2\n");
});
