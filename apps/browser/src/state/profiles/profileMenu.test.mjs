import assert from "node:assert/strict";
import { test } from "node:test";
const { profileMenuItems } = await import("./profileMenu.ts");
const { closeProfileIconPickerIfShown, useProfileIconPicker } = await import("./iconPicker.ts");

const G = { control: "⌃", option: "⌥", shift: "⇧", command: "⌘" };
const keys = (i) => (i.key ? ["control", "option", "shift", "command"].filter((m) => i.modifiers?.includes(m)).map((m) => G[m]).join("") + i.key.toUpperCase() : "");
const render = (items, depth = 0) =>
  items.flatMap((i) => [
    "  ".repeat(depth) + (i.separator ? "---" : [i.checked ? "✓" : "", i.title, keys(i), i.symbol ? `[${i.symbol}]` : "", i.swatch ? "(swatch)" : "", i.enabled === false ? "(off)" : "", i.children ? "›" : ""].filter(Boolean).join(" ")),
    ...(i.children ? render(i.children, depth + 1) : []),
  ]);

const base = {
  place: "sidebar",
  hasIcon: false,
  colors: [
    { id: "plum", title: "Plum", swatch: "#C07A98" },
    { id: "blue", title: "Blue", swatch: "#4691C3" },
  ],
  color: "blue",
  isDefault: true,
  only: false,
  sharesTopApps: null,
};

test("a profile's menu in the sidebar: Rename…, the icon picker and its colour, Profile Settings…, and Delete Profile… last", () => {
  assert.deepEqual(render(profileMenuItems(base)), [
    "Rename… [pencil]",
    "Add Icon… [photo]",
    "Color [paintpalette] ›",
    "  Plum (swatch)",
    "  ✓ Blue (swatch)",
    "---",
    "Profile Settings… [gearshape]",
    "---",
    "Delete Profile… [trash]",
  ]);
  const custom = render(profileMenuItems({ ...base, hasIcon: true, color: null, only: true }));
  assert.equal(custom[1], "Change Icon… [photo]");
  assert.ok(!custom.some((l) => l.startsWith("  ✓") && l.includes("swatch")));
  assert.equal(custom.at(-1), "Delete Profile… [trash] (off)");
});

test("in Settings the same verbs, with the details and default choices in place of Profile Settings…", () => {
  const items = render(profileMenuItems({ ...base, place: "settings" }));
  assert.deepEqual(items.slice(5), ["---", "Show Profile Details [info.circle]", "Make Default Profile [star] (off)", "---", "Delete Profile… [trash]"]);
});

test("a profile that shares data has a Share Top Apps check in its menu; one with its own data doesn't", () => {
  const on = render(profileMenuItems({ ...base, sharesTopApps: true }));
  assert.deepEqual(on.slice(5, 8), ["---", "✓ Share Top Apps [square.grid.2x2]", "---"]);
  const off = render(profileMenuItems({ ...base, sharesTopApps: false }));
  assert.ok(off.includes("Share Top Apps [square.grid.2x2]"));
  assert.ok(!off.some((l) => l.startsWith("✓ Share Top Apps")), "unchecked when off");
  assert.ok(!render(profileMenuItems(base)).some((l) => l.includes("Share Top Apps")));
});

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
