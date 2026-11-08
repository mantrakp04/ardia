import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const delegate = readFileSync(new URL("../../../engine/ardiacore/src/ardia/core/ac_main_delegate.cc", import.meta.url), "utf8");
const buildFile = readFileSync(new URL("../../../engine/ardiacore/src/ardia/core/BUILD.gn", import.meta.url), "utf8");

const slice = (from, to) => {
  const start = delegate.indexOf(from);
  const end = delegate.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `${from} … ${to} not found`);
  return delegate.slice(start, end);
};

test("the browser process turns on Chromium's macOS system sharing picker, so window shares get their filter from macOS", () => {
  const browserBranch = slice("  if (!command_line->HasSwitch(switches::kProcessType)) {", "  if (command_line->HasSwitch(extensions::switches::kExtensionProcess)) {");
  assert.match(browserBranch, /EnableFeature\(command_line, media::kUseSCContentSharingPicker\);/);
});

test("the feature is named by Chromium's own symbol, so a rename breaks the build instead of silently doing nothing", () => {
  assert.match(delegate, /#include "media\/base\/media_switches\.h"/);
  assert.doesNotMatch(delegate, /(?<!k)UseSCContentSharingPicker/);
  assert.match(buildFile, /"\/\/media",/);
});

test("EnableFeature merges the feature's name into --enable-features", () => {
  const helper = slice("void EnableFeature(", "constexpr int kDiskSpaceCheckSeconds");
  assert.match(helper, /const base::Feature& feature/);
  assert.match(helper, /MergeFeatures\(command_line, switches::kEnableFeatures, feature\.name\);/);
});
