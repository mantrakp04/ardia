import assert from "node:assert/strict";
import { test } from "node:test";
const { downloadMenuItems } = await import("./downloadMenu.ts");

const G = { control: "⌃", option: "⌥", shift: "⇧", command: "⌘" };
const keys = (i) => (i.key ? ["control", "option", "shift", "command"].filter((m) => i.modifiers?.includes(m)).map((m) => G[m]).join("") + i.key.toUpperCase() : "");
const render = (items, depth = 0) =>
  items.flatMap((i) => [
    "  ".repeat(depth) + (i.separator ? "---" : [i.checked ? "✓" : "", i.title, keys(i), i.symbol ? `[${i.symbol}]` : "", i.swatch ? "(swatch)" : "", i.enabled === false ? "(off)" : "", i.children ? "›" : ""].filter(Boolean).join(" ")),
    ...(i.children ? render(i.children, depth + 1) : []),
  ]);

const base = { held: false, downloading: false, paused: false, opensWhenDone: false, fileExists: true };

test("a finished download: Open and Show in Finder, Copy Link, then Remove from List and Move to Trash last", () => {
  assert.deepEqual(render(downloadMenuItems(base)), [
    "Open [arrow.up.forward.app]",
    "Show in Finder [folder]",
    "---",
    "Copy Link [link]",
    "Show All Downloads [arrow.down.circle]",
    "---",
    "Remove from List [minus.circle]",
    "Move to Trash [trash]",
  ]);
  assert.deepEqual(render(downloadMenuItems({ ...base, fileExists: false })), [
    "Open [arrow.up.forward.app] (off)",
    "Show in Finder [folder] (off)",
    "---",
    "Copy Link [link]",
    "Show All Downloads [arrow.down.circle]",
    "---",
    "Remove from List [minus.circle]",
  ]);
});

test("a running download leads with its controls, a held one with Keep and Discard; neither can leave the list yet", () => {
  assert.deepEqual(render(downloadMenuItems({ ...base, downloading: true, opensWhenDone: true, fileExists: false })).slice(0, 4), ["✓ Open When Done", "Pause [pause]", "Cancel [xmark.circle]", "---"]);
  assert.equal(render(downloadMenuItems({ ...base, downloading: true, paused: true, fileExists: false }))[1], "Resume [play]");
  const held = render(downloadMenuItems({ ...base, held: true, downloading: true, fileExists: false }));
  assert.deepEqual(held.slice(0, 3), ["Keep [checkmark.circle]", "Discard [xmark.circle]", "---"]);
  assert.equal(held.at(-1), "Remove from List [minus.circle] (off)");
});
