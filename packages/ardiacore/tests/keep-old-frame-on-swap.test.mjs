import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const patchName = "chromium-keep-old-frame-on-swap.patch";
const compositorFile = "content/browser/renderer_host/browser_compositor_view_mac.mm";
const viewFile = "content/browser/renderer_host/render_widget_host_view_mac.mm";
const patchesUrl = (name) => new URL(`../../../engine/patches/${name}`, import.meta.url);
const read = (url) => readFileSync(url, "utf8");
const patchText = () => read(patchesUrl(patchName));
const seriesEntries = () =>
  read(patchesUrl("series"))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const addedLinesByFile = (patch) => {
  const files = new Map();
  let current = null;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++ b/")) {
      current = line.slice("+++ b/".length);
      files.set(current, []);
    } else if (current && line.startsWith("+")) {
      files.get(current).push(line.slice(1));
    }
  }
  return files;
};

const added = (file) => {
  const lines = addedLinesByFile(patchText()).get(file);
  assert.ok(lines, `${patchName} does not change ${file}`);
  return lines.join("\n");
};

test("the series applies the same-site swap patch after the patch that edits the same compositor files", () => {
  const entries = seriesEntries();
  const own = entries.indexOf(`chromium ${patchName}`);
  const base = entries.indexOf("chromium chromium-video-super-resolution.patch");
  assert.ok(own >= 0, `engine/patches/series does not list ${patchName}`);
  assert.ok(base >= 0 && own > base, `${patchName} must come after chromium-video-super-resolution.patch`);
  assert.ok(existsSync(patchesUrl(patchName)));
});

test("a view that hides with a frame on screen keeps its compositor and last frame for the page that takes over", () => {
  const compositor = added(compositorFile);
  assert.match(compositor, /new_state == HasNoCompositor && last_ca_layer_params/);
  assert.match(compositor, /retired_compositor_ = std::move\(recyclable_compositor_\)/);
  assert.match(compositor, /return &retired_ca_layer_params_/);
  assert.match(compositor, /retired_compositor_ = std::move\(other->retired_compositor_\)/);
});

test("the retired compositor is released once the new view has drawn its first frame", () => {
  const patch = patchText().split("\n");
  const update = patch.indexOf("   ns_view_->SetCALayerParams(std::move(ca_layer_params));");
  assert.ok(update >= 0, "the patch does not touch AcceleratedWidgetCALayerParamsUpdated");
  assert.equal(patch[update + 1], "+  browser_compositor_->ReleaseRetiredCompositor();");
  assert.ok(addedLinesByFile(patchText()).has(viewFile));
});

test("a retired compositor nobody takes is released on a bound, when the view hides again and on destruction", () => {
  const patch = patchText();
  const compositor = added(compositorFile);
  assert.match(compositor, /retired_compositor_timer_\.Start\(/);
  assert.match(compositor, /void BrowserCompositorMac::ReleaseRetiredCompositor\(\) \{\n {2}retired_compositor_timer_\.Stop\(\);\n {2}retired_compositor_\.reset\(\);/);
  assert.ok(patch.includes("   TransitionToState(HasNoCompositor);\n+  ReleaseRetiredCompositor();\n"));
  assert.ok(patch.includes("   if (state_ == HasOwnCompositor) {\n+    ReleaseRetiredCompositor();\n"));
});

test("the patch adds no comments", () => {
  for (const [file, lines] of addedLinesByFile(patchText())) {
    for (const line of lines) {
      assert.doesNotMatch(line, /^\s*(\/\/|\/\*|\*)/, `${file}: ${line}`);
    }
  }
});

test("the patch is listed in the engine build doc", () => {
  const doc = read(new URL("../../../docs/engine-build.md", import.meta.url));
  assert.ok(doc.includes(`\`${patchName}\``), `docs/engine-build.md does not list ${patchName}`);
});
