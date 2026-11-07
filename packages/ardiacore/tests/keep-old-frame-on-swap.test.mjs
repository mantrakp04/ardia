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

test("a retired compositor is released after its lifetime, when the view hides again and on destruction", () => {
  const patch = patchText();
  const compositor = added(compositorFile);
  assert.match(compositor, /kUnclaimedRetiredCompositorLifetime =\n\s+base::Milliseconds\(100\);/);
  assert.match(compositor, /kRetiredCompositorLifetime = base::Seconds\(4\);/);
  assert.match(compositor, /retired_compositor_timer_\.Start\(\n\s+FROM_HERE, kUnclaimedRetiredCompositorLifetime, this,\n\s+&BrowserCompositorMac::ReleaseRetiredCompositor\);/);
  assert.match(compositor, /retired_compositor_timer_\.Start\(\n\s+FROM_HERE, kRetiredCompositorLifetime, this,\n\s+&BrowserCompositorMac::ReleaseRetiredCompositor\);/);
  assert.match(compositor, /void BrowserCompositorMac::ReleaseRetiredCompositor\(\) \{\n {2}retired_compositor_timer_\.Stop\(\);\n {2}retired_compositor_\.reset\(\);/);
  assert.ok(patch.includes("   TransitionToState(HasNoCompositor);\n+  ReleaseRetiredCompositor();\n"));
  assert.ok(patch.includes("   if (state_ == HasOwnCompositor) {\n+    ReleaseRetiredCompositor();\n"));
});

test("a compositor retired by a hide is released at once unless the new view takes it over, which gives it the full lifetime", () => {
  const compositor = added(compositorFile);
  const retire = compositor.indexOf("retired_compositor_ = std::move(recyclable_compositor_)");
  const retireStart = compositor.indexOf("retired_compositor_timer_.Start(", retire);
  assert.ok(retire >= 0 && retireStart > retire);
  assert.match(compositor.slice(retireStart, retireStart + 120), /kUnclaimedRetiredCompositorLifetime/);
  const take = compositor.indexOf("retired_compositor_ = std::move(other->retired_compositor_)");
  const takeStart = compositor.indexOf("retired_compositor_timer_.Start(", take);
  assert.ok(take >= 0 && takeStart > take);
  assert.match(compositor.slice(takeStart, takeStart + 120), /kRetiredCompositorLifetime/);
});

const hunkHeader = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;

const hunkProblems = (patch) => {
  const lines = patch.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const problems = [];
  let hunks = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].startsWith("@@")) continue;
    const header = hunkHeader.exec(lines[index]);
    if (!header) {
      problems.push(`${lines[index]} is not a hunk header`);
      continue;
    }
    hunks += 1;
    const oldLength = Number(header[1] ?? 1);
    const newLength = Number(header[2] ?? 1);
    let removed = 0;
    let inserted = 0;
    let cursor = index + 1;
    while (cursor < lines.length && removed + inserted < oldLength + newLength) {
      const marker = lines[cursor][0];
      if (marker === " " || lines[cursor] === "") {
        removed += 1;
        inserted += 1;
      } else if (marker === "-") {
        removed += 1;
      } else if (marker === "+") {
        inserted += 1;
      } else {
        break;
      }
      cursor += 1;
    }
    if (removed !== oldLength) problems.push(`${lines[index]} declares a different old length`);
    if (inserted !== newLength) problems.push(`${lines[index]} declares a different new length`);
    if (cursor < lines.length && !/^(@@|--- |\+\+\+ )/.test(lines[cursor])) problems.push(`${lines[index]} is followed by extra lines`);
  }
  return { hunks, problems };
};

test("every hunk of the patch has the line counts its header declares", () => {
  const { hunks, problems } = hunkProblems(patchText());
  assert.deepEqual(problems, []);
  assert.ok(hunks > 0);
});

test("the hunk check reads a header that leaves out the count of a one-line side as 1", () => {
  const valid = ["--- a/f", "+++ b/f", "@@ -72 +73,2 @@", "-old", "+new", "+extra", "@@ -80,2 +82 @@", " kept", "-gone", ""].join("\n");
  assert.deepEqual(hunkProblems(valid), { hunks: 2, problems: [] });
  const wrongNew = ["--- a/f", "+++ b/f", "@@ -72 +73 @@", "-old", "+new", "+extra", ""].join("\n");
  assert.notDeepEqual(hunkProblems(wrongNew).problems, []);
  const wrongOld = ["--- a/f", "+++ b/f", "@@ -72 +73 @@", "-old", "-older", "+new", ""].join("\n");
  assert.notDeepEqual(hunkProblems(wrongOld).problems, []);
});

test("the hunk check fails on an @@ line that is not a hunk header", () => {
  const malformed = ["--- a/f", "+++ b/f", "@@ -72,1 +73,1", "-old", "+new", ""].join("\n");
  assert.notDeepEqual(hunkProblems(malformed).problems, []);
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
