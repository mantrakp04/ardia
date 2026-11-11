import assert from "node:assert/strict";
import { test } from "node:test";
const stub = await import("../../test-native/index.ts");
const captured = [];
stub.shellNativeModules.ArdiaFocus.setDragEscapeCapture = (on) => (captured.push(on), Promise.resolve());
const { useBrowser } = await import("../browser/store.ts");
const { PLATFORM_FEATURES } = await import("../../lib/platformFeatures.ts");
const windowsFeatures = (await import("../../lib/platformFeatures.windows.ts")).PLATFORM_FEATURES;

const S = () => useBrowser.getState();
const PERSONAL = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };

test("Escape closes the Downloads popover where the platform asks for it, and only there", async () => {
  assert.equal(PLATFORM_FEATURES.escapeClosesDownloads, false, "the Mac keeps Downloads out of the Escape capture");
  assert.equal(windowsFeatures.escapeClosesDownloads, true, "Windows holds Escape while Downloads is open");

  S().hydrate({ profiles: { default: PERSONAL }, profileOrder: ["default"] });
  const a = S().createWindow({});
  const b = S().createWindow({});
  S().setFocusedWindow(a);

  const asMac = await import("./popoverDismiss.ts?mac");
  asMac.startPopoverEscape(PLATFORM_FEATURES.escapeClosesDownloads);
  S().setDownloadsOpen(a, true);
  assert.deepEqual(captured, [], "the Mac path never captures Escape for Downloads");
  stub.emitAppEvent({ type: "dragEscape" });
  assert.equal(S().windowUi[a]?.downloadsOpen, true, "the Mac path leaves Downloads open");

  const asWindows = await import("./popoverDismiss.ts?windows");
  asWindows.startPopoverEscape(windowsFeatures.escapeClosesDownloads);
  S().setDownloadsOpen(a, false);
  S().setDownloadsOpen(a, true);
  assert.equal(captured.at(-1), true, "opening Downloads in the focused window captures Escape");

  S().setFocusedWindow(b);
  assert.equal(captured.at(-1), false, "focusing a window without Downloads open releases it");
  S().setFocusedWindow(a);
  assert.equal(captured.at(-1), true);

  stub.emitAppEvent({ type: "dragEscape" });
  assert.equal(S().windowUi[a]?.downloadsOpen, false, "Escape closes Downloads in the focused window");
  assert.equal(captured.at(-1), false, "and releases Escape once nothing is left to close");

  S().setDownloadsOpen(b, true);
  stub.emitAppEvent({ type: "dragEscape" });
  assert.equal(S().windowUi[b]?.downloadsOpen, true, "Escape never closes Downloads in a window that is not focused");
});
