import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../../store/browser.ts");
const { openThemePanel, toggleThemePanel, useThemePanel } = await import("./panelState.ts");

const S = () => useBrowser.getState();

test("the theme panel opens for the window's space, never in a private window", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.example/" });
  const secret = S().createWindow({ incognito: true, url: "https://b.example/" });
  openThemePanel(secret);
  assert.equal(useThemePanel.getState().open[secret], undefined);
  toggleThemePanel(w);
  assert.equal(useThemePanel.getState().open[w], S().windows[w].profileId);
  toggleThemePanel(w);
  assert.equal(useThemePanel.getState().open[w], undefined);
});

test("the panel only ever targets the window's current space, and Esc from the page closes it", async () => {
  const { closeThemePanelIn } = await import("./panelState.ts");
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.example/" });
  const other = S().createProfile({ name: "Work" });
  openThemePanel(w, other);
  assert.equal(useThemePanel.getState().open[w], S().windows[w].profileId, "an extra argument can't aim it at another space");
  assert.equal(closeThemePanelIn(w), true);
  assert.equal(useThemePanel.getState().open[w], undefined);
  assert.equal(closeThemePanelIn(w), false, "Esc falls through to the next handler when the panel is closed");
  assert.equal(closeThemePanelIn(undefined), false);
});


test("space dots shrink to fit the footer between its buttons", async () => {
  const { profileDotCell } = await import("../profiles/dotCell.ts");
  assert.equal(profileDotCell(3, 102), 12);
  assert.equal(profileDotCell(10, 102), 10.2);
  assert.ok(profileDotCell(10, 102) * 10 <= 102);
  assert.equal(profileDotCell(40, 102), 8, "never smaller than a dot and its gap");
  assert.equal(profileDotCell(10), 12);
});
