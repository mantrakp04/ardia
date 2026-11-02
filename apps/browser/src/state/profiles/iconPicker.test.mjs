import assert from "node:assert/strict";
import { test } from "node:test";
const { closeProfileIconPickerIfShown, useProfileIconPicker } = await import("./iconPicker.ts");

const pickerFor = (profileId) => ({ profileId, windowId: "w", place: "settings", anchor: null });

test("a stale picker's close leaves the picker opened after it alone", () => {
  const stale = pickerFor("gone");
  const shown = pickerFor("work");
  useProfileIconPicker.setState({ picker: shown });
  closeProfileIconPickerIfShown(stale);
  assert.equal(useProfileIconPicker.getState().picker, shown);
  closeProfileIconPickerIfShown(shown);
  assert.equal(useProfileIconPicker.getState().picker, null);
});
