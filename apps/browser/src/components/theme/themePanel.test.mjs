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
  openThemePanel(w, "no-such-space");
  assert.equal(useThemePanel.getState().open[w], undefined);
});
