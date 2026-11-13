import assert from "node:assert/strict";
import { test } from "node:test";
await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { closeBlankLittleArdiaOnEscape } = await import("./actions.ts");
const { escapePressed } = await import("../windows/unclaimedEscape.ts");
const { isWindowClosing } = await import("../windows/closeAnimated.ts");

const S = () => useBrowser.getState();
const PERSONAL = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };
const gone = (windowId) => !S().windows[windowId] || isWindowClosing(windowId);

function windows(url) {
  S().hydrate({ profiles: { default: PERSONAL }, profileOrder: ["default"], windows: {}, tabs: {} });
  const main = S().createWindow({ url: "https://main.example/" });
  const small = S().createWindow({ kind: "small", url });
  return { main, small, mainTab: S().windows[main].tabIds[0], smallTab: S().windows[small].tabIds[0] };
}

for (const pressedIn of ["page", "window"]) {
  test(`Escape pressed in the ${pressedIn} closes a Little Ardia window and leaves the main window alone`, () => {
    const { main, small, mainTab, smallTab } = windows("https://little.example/");
    escapePressed(mainTab, pressedIn);
    assert.equal(gone(main), false);
    assert.equal(gone(small), false);
    escapePressed(smallTab, pressedIn);
    assert.equal(gone(small), true);
    assert.equal(gone(main), false);
  });
}

test("Escape closes the address bar of a Little Ardia page first, and the window on the next press", () => {
  const { small, smallTab } = windows("https://little.example/");
  S().openPanel(small, "https://little.example/");
  escapePressed(smallTab, "window");
  assert.equal(gone(small), false);
  assert.equal(closeBlankLittleArdiaOnEscape(small), false);
  assert.equal(gone(small), false);
  S().closePanel(small);
  escapePressed(smallTab, "window");
  assert.equal(gone(small), true);
});

test("Escape in a blank Little Ardia's address bar closes the window, and never a main window's", () => {
  const { main, small } = windows(undefined);
  S().openPanel(small, "");
  assert.equal(closeBlankLittleArdiaOnEscape(main), false);
  assert.equal(gone(main), false);
  assert.equal(closeBlankLittleArdiaOnEscape(small), true);
  assert.equal(gone(small), true);
});
