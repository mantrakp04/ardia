import assert from "node:assert/strict";
import { test } from "node:test";
const { profileMenuItems } = await import("./profileMenu.ts");

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
  iconItems: [{ value: { icon: null }, title: "None", checked: true }],
  colors: [
    { id: "plum", title: "Plum", swatch: "#C07A98" },
    { id: "blue", title: "Blue", swatch: "#4691C3" },
  ],
  color: "blue",
  isDefault: true,
  only: false,
};

test("a profile's menu in the sidebar: Rename…, its icon and colour, Profile Settings…, and Delete Profile… last", () => {
  assert.deepEqual(render(profileMenuItems(base)), [
    "Rename… [pencil]",
    "Add Icon [photo] ›",
    "  ✓ None",
    "Color [paintpalette] ›",
    "  Plum (swatch)",
    "  ✓ Blue (swatch)",
    "---",
    "Profile Settings… [gearshape]",
    "---",
    "Delete Profile… [trash]",
  ]);
  const custom = render(profileMenuItems({ ...base, hasIcon: true, color: null, only: true }));
  assert.equal(custom[1], "Change Icon [photo] ›");
  assert.ok(!custom.some((l) => l.startsWith("  ✓") && l.includes("swatch")));
  assert.equal(custom.at(-1), "Delete Profile… [trash] (off)");
});

test("in Settings the same verbs, with the details and default choices in place of Profile Settings…", () => {
  const items = render(profileMenuItems({ ...base, place: "settings" }));
  assert.deepEqual(items.slice(6), ["---", "Show Profile Details [info.circle]", "Make Default Profile [star] (off)", "---", "Delete Profile… [trash]"]);
});
