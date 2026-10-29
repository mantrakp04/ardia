import assert from "node:assert/strict";
import test from "node:test";
import { webviews as shared } from "../../browser/src/platform/webviews.ts";
import { dragWebviews } from "./dragWebviews.ts";

test("a tab drag takes no page picture while the host has no drag preview to show it in", async () => {
  let captures = 0;
  const handle = { capturePicture: async () => { captures++; return { data: "data:image/png;base64,", frame: [0, 0, 1, 1] }; } };
  shared.set("tab-1", handle);
  try {
    const host = { bootstrap: { capabilities: ["ArdiaShell.pickFiles"] } };
    const gated = dragWebviews(host);
    assert.equal(gated.get("tab-1"), undefined);
    assert.equal(captures, 0);
    host.bootstrap.capabilities.push("ArdiaShell.dragPreviewPage");
    assert.equal(gated.get("tab-1"), handle);
    assert.equal(gated.get("missing"), undefined);
  } finally {
    shared.delete("tab-1");
  }
});
