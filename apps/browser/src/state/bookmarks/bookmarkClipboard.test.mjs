import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { copyBookmarkNodes, cutBookmarkNodes, pasteBookmarkNodes } = await import("./bookmarkClipboard.ts");

const S = () => useBrowser.getState();

test("copy creates a new nested tree with bookmark fields and cut moves the original IDs across profiles", () => {
  S().hydrate({});
  const defaultProfile = S().profiles.default;
  useBrowser.setState({
    profiles: { ...S().profiles, work: { ...defaultProfile, id: "work", name: "Work", dataId: "work" } },
    profileOrder: [...S().profileOrder, "work"],
  });
  const folder = S().addBookmarkFolder({ profileId: "default", title: "Nested", parentId: undefined });
  const link = S().addBookmark({ profileId: "default", title: "Example", url: "https://example.invalid/", favicon: "data:image/png;base64,AA==", parentId: folder });
  const original = S().bookmarks.nodes[link];

  copyBookmarkNodes([folder]);
  const copied = pasteBookmarkNodes("work");
  const copiedFolder = S().bookmarks.nodes[copied[0]];
  assert.equal(copied.length, 1);
  assert.notEqual(copied[0], folder);
  assert.equal(copiedFolder.kind, "folder");
  const copiedLink = S().bookmarks.nodes[copiedFolder.children[0]];
  assert.notEqual(copiedLink.id, link);
  assert.equal(copiedLink.kind, "url");
  assert.equal(copiedLink.title, original.title);
  assert.equal(copiedLink.url, original.url);
  assert.equal(copiedLink.favicon, original.favicon);
  assert.equal(copiedLink.addedAt, original.addedAt);

  cutBookmarkNodes([folder]);
  assert.equal(S().bookmarks.nodes[folder], undefined);
  const moved = pasteBookmarkNodes("work");
  assert.deepEqual(moved, [folder]);
  assert.equal(S().bookmarks.nodes[folder].kind, "folder");
  assert.equal(S().bookmarks.nodes[folder].parentId, "bar@work");
  assert.equal(S().bookmarks.nodes[link].kind, "url");
  assert.equal(S().bookmarks.nodes[link].parentId, folder);
  assert.equal(S().bookmarks.nodes[link].favicon, original.favicon);
});
