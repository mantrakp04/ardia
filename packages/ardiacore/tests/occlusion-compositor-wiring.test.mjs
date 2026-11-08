import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const patchName = "chromium-keep-compositor-on-occlusion.patch";
const keepOldFrame = "chromium-keep-old-frame-on-swap.patch";
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const patchUrl = new URL(`../../../engine/patches/${patchName}`, import.meta.url);
const patch = existsSync(patchUrl) ? readFileSync(patchUrl, "utf8") : "";
const series = read("../../../engine/patches/series")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));
const patchLines = patch.split("\n");
const added = patchLines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).map((line) => line.slice(1).trim());
const removed = patchLines.filter((line) => line.startsWith("-") && !line.startsWith("---")).map((line) => line.slice(1).trim());
const addedText = added.join("\n");

const requirePatch = () => {
  assert.ok(patch, `an occluded window's page view still drops its compositor and last frame: ${patchName} is missing`);
};

const block = (start) => {
  const index = added.indexOf(start);
  assert.ok(index >= 0, `${patchName} does not add: ${start}`);
  return added.slice(index);
};

test("the occlusion patch is applied right after keep-old-frame, which it builds on", () => {
  requirePatch();
  const at = series.indexOf(`chromium ${keepOldFrame}`);
  assert.ok(at >= 0, `${keepOldFrame} is not in the series`);
  assert.equal(series[at + 1], `chromium ${patchName}`);
});

test("a hidden host whose view is still visible keeps its own compositor, so its last frame stays on screen", () => {
  requirePatch();
  const hold = block("if (state_ == HasOwnCompositor && root_layer_->visible()) {");
  assert.equal(hold[1], 'TRACE_EVENT_INSTANT("content", "BrowserCompositorMac::HoldForOcclusion");');
  assert.equal(hold[2], "return;");
  assert.equal(hold[3], "}");
  assert.ok(!addedText.includes("kUnclaimedRetiredCompositorLifetime"), "a tab switch keeps its 100 ms release");
  assert.ok(!removed.some((line) => line.includes("kUnclaimedRetiredCompositorLifetime")));
});

test("a view that really hides while its compositor is held lets the compositor go", () => {
  requirePatch();
  const release = block("if (!visible && render_widget_host_is_hidden_ &&");
  assert.equal(release[1], "state_ == HasOwnCompositor) {");
  assert.equal(release[2], "UpdateState();");
  assert.equal(release[3], "}");
  assert.ok(patch.includes("void BrowserCompositorMac::SetViewVisible(bool visible) {"));
});

test("showing a view with a held compositor embeds the renderer's surface again", () => {
  requirePatch();
  const show = block("if (was_held && !hidden && state_ == HasOwnCompositor) {");
  assert.equal(show[1], 'TRACE_EVENT_INSTANT("content", "BrowserCompositorMac::ShowHeld");');
  assert.equal(show[2], "delegated_frame_host_->WasShown(GetRendererLocalSurfaceId(), dfh_size_dip_,");
  assert.equal(show[3], "{});");
  assert.ok(addedText.replace(/\s+/g, " ").includes("const bool was_held = state_ == HasOwnCompositor && render_widget_host_is_hidden_;"));
});

test("the occlusion patch holds no comments", () => {
  requirePatch();
  const comment = added.filter((line) => /^(\/\/|\/\*|\*|#)/.test(line));
  assert.deepEqual(comment, []);
});

test("docs/engine-build.md lists the occlusion patch", () => {
  const docs = read("../../../docs/engine-build.md");
  assert.ok(docs.includes(`\`${patchName}\``), `docs/engine-build.md has no row for ${patchName}`);
});
