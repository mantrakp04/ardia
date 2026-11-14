import assert from "node:assert/strict";
import { test } from "node:test";

const { SYNC_CODE_QUIET, SYNC_CODE_SIZE, syncCodeFrame } = await import("./syncCodeFrame.ts");
const { colorRoles } = await import("../../ui/tokens.ts");
const { luminance, over } = await import("../../../lib/color.ts");

const SHORTEST_PHRASE_IMAGE = 43;
const LONGEST_PHRASE_IMAGE = 63;
const IMAGE_QUIET_MODULES = 1;
const FRAME_BORDER = 1;
const QUIET_MODULES = 4;
const MIN_MODULE_POINTS = 2.5;
const MIN_TEXT_CONTRAST = 4.5;

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test("the Show Code button reads on the frame it sits on, in dark and light", () => {
  for (const mode of ["dark", "light"]) {
    const theme = colorRoles[mode];
    const frame = over(syncCodeFrame(theme, false).backgroundColor, theme.panel);
    for (const fill of [theme.control, theme.controlHover, theme.controlPressed])
      assert.ok(contrast(theme.textPrimary, over(fill, frame)) >= MIN_TEXT_CONTRAST, `${mode}: ${theme.textPrimary} on ${fill} over ${frame}`);
  }
});

test("a shown code sits on white in dark and light, so its dark modules scan", () => {
  for (const mode of ["dark", "light"]) assert.equal(syncCodeFrame(colorRoles[mode], true).backgroundColor.toUpperCase(), "#FFFFFF", mode);
});

test("every phrase's code keeps a four-module quiet zone and modules a phone camera resolves", () => {
  for (let image = SHORTEST_PHRASE_IMAGE; image <= LONGEST_PHRASE_IMAGE; image += 4) {
    const module = SYNC_CODE_SIZE / image;
    const quiet = IMAGE_QUIET_MODULES * module + SYNC_CODE_QUIET - FRAME_BORDER;
    assert.ok(module >= MIN_MODULE_POINTS, `${image}: ${module} pt per module`);
    assert.ok(quiet >= QUIET_MODULES * module, `${image}: ${quiet} pt around ${module} pt modules`);
  }
});
