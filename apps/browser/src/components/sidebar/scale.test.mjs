import assert from "node:assert/strict";
import { test } from "node:test";
const { sidebarScale } = await import("./scale.ts");
const { TAB_ROW, TILE_STATUS } = await import("./tokens.ts");
const { font, iconButton } = await import("../ui/tokens.ts");
const { SIDEBAR_SCALES } = await import("../../lib/sidebarMetrics.ts");

test("at 100% the sidebar's row pieces are today's sizes", () => {
  const m = sidebarScale(100);
  assert.deepEqual(m.tabRow, { ...TAB_ROW });
  assert.equal(m.font.body, font.body.fontSize);
  assert.equal(m.font.compact, font.small.fontSize);
  assert.equal(m.icon, 16);
  assert.deepEqual(m.rowButton, { box: iconButton.s.box, glyph: iconButton.s.glyph });
  assert.deepEqual(m.tileStatus, { pip: TILE_STATUS.pip, speaker: TILE_STATUS.speaker, box: { ...TILE_STATUS.box }, inset: { ...TILE_STATUS.inset } });
  assert.deepEqual(m.titleFrame, { flex: 1, height: TAB_ROW.titleHeight, marginLeft: TAB_ROW.titleGap });
});

test("text, icons, padding and the close button scale together with the row", () => {
  const m = sidebarScale(90);
  assert.equal(m.rowHeight, 30.5);
  assert.equal(m.font.body, 11.5);
  assert.equal(m.icon, 14.5);
  assert.equal(m.tabRow.titleHeight, 16);
  assert.equal(m.rowButton.box, 20);
  for (const percent of SIDEBAR_SCALES) {
    const s = sidebarScale(percent);
    assert.ok(s.icon < s.rowHeight && s.tabRow.titleHeight < s.rowHeight && s.rowButton.box < s.rowHeight, `${percent}%: pieces fit the row`);
    assert.ok(s.tabRow.contentLeft + s.icon + s.tabRow.titleGap + s.rowButton.box + s.tabRow.trailing < 160, `${percent}%: a row fits the narrowest sidebar`);
  }
  assert.equal(sidebarScale(90), sidebarScale(90));
  assert.equal(sidebarScale(93), sidebarScale(100));
});
