import assert from "node:assert/strict";
import { test } from "node:test";
const { activeLook, iconName, setActiveLook, withIconNames } = await import("./activeLook.ts");
const { DEFAULT_LOOK, parseLookBlocks, resolveLook } = await import("./themeLook.ts");

const lookOf = (doc) => resolveLook(parseLookBlocks("themes/t.json", doc, []));

test("the active look starts as Ardia's own, and swapped icons reach symbols and native menus, submenus included", () => {
  assert.equal(activeLook(), DEFAULT_LOOK);
  const items = [{ id: "a", title: "A", symbol: "plus" }, { separator: true }, { id: "b", title: "B", children: [{ id: "c", title: "C", symbol: "trash" }] }];
  assert.equal(withIconNames(items), items, "no icons: the same items, no copies");
  setActiveLook(lookOf({ icons: { plus: "plus.circle", trash: "trash.fill" }}));
  try {
    assert.equal(iconName("plus"), "plus.circle");
    assert.equal(iconName("star"), "star");
    assert.deepEqual(withIconNames(items), [
      { id: "a", title: "A", symbol: "plus.circle" },
      { separator: true },
      { id: "b", title: "B", children: [{ id: "c", title: "C", symbol: "trash.fill" }] },
    ]);
  } finally {
    setActiveLook(DEFAULT_LOOK);
  }
});
