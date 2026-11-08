import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { peekOpenedFrom } = await import("./peek.ts");

const S = () => useBrowser.getState();
const PERSONAL = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };

test("the tab a Peek was opened from knows its Peek until the Peek closes", () => {
  S().hydrate({ profiles: { default: PERSONAL }, profileOrder: ["default"] });
  const w = S().createWindow({ url: "https://a.example/" });
  const a = S().windows[w].tabIds[0];
  const b = S().newTab(w, { url: "https://b.example/", background: true });
  S().activate(a);
  assert.equal(peekOpenedFrom(S(), a), undefined);
  const peek = S().openPeek(a, "https://peeked.example/");
  assert.equal(peekOpenedFrom(S(), a), peek);
  assert.equal(peekOpenedFrom(S(), b), undefined);
  assert.equal(peekOpenedFrom(S(), peek), undefined);
  S().closePeek(w);
  assert.equal(peekOpenedFrom(S(), a), undefined);
});
