import assert from "node:assert/strict";
import { test } from "node:test";
const { spaceMenuItems } = await import("./spaceMenu.ts");

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

test("a profile's menu in the sidebar: Rename…, its icon and colour, Space Settings…, and Delete Space… last", () => {
  assert.deepEqual(render(spaceMenuItems(base)), [
    "Rename… [pencil]",
    "Add Icon [photo] ›",
    "  ✓ None",
    "Color [paintpalette] ›",
    "  Plum (swatch)",
    "  ✓ Blue (swatch)",
    "---",
    "Space Settings… [gearshape]",
    "---",
    "Delete Space… [trash]",
  ]);
  const custom = render(spaceMenuItems({ ...base, hasIcon: true, color: null, only: true }));
  assert.equal(custom[1], "Change Icon [photo] ›");
  assert.ok(!custom.some((l) => l.startsWith("  ✓") && l.includes("swatch")));
  assert.equal(custom.at(-1), "Delete Space… [trash]");
});

test("in Settings the same verbs, with the details and default choices in place of Space Settings…", () => {
  const items = render(spaceMenuItems({ ...base, place: "settings" }));
  assert.deepEqual(items.slice(6), ["---", "Show Space Details [info.circle]", "Make Default Space [star] (off)", "---", "Delete Space… [trash]"]);
});
