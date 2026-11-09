import assert from "node:assert/strict";
import { test } from "node:test";
import { splitReplyingTo, tweetSegments, videoTimestampLabel } from "./tweet-text.ts";

test("t.co links show their display URL and point at the expanded URL", () => {
  const segments = tweetSegments("try this https://t.co/abc123 now", {
    urls: [{ url: "https://t.co/abc123", expanded_url: "https://ardia.dev/download", display_url: "ardia.dev/download" }],
  });
  assert.deepEqual(segments, [
    { kind: "text", text: "try this " },
    { kind: "link", text: "ardia.dev/download", href: "https://ardia.dev/download" },
    { kind: "text", text: " now" },
  ]);
});

test("media links are dropped because the media renders below the text", () => {
  const segments = tweetSegments("look https://t.co/pic", {
    urls: [{ url: "https://t.co/pic", expanded_url: "https://x.com/a/status/1/photo/1", display_url: "pic.x.com/pic", media_key: "3_1" }],
  });
  assert.deepEqual(segments, [{ kind: "text", text: "look" }]);
});

test("mentions and hashtags link to X, and HTML entities decode", () => {
  const segments = tweetSegments("@arc &amp; #browsers are done", null);
  assert.deepEqual(segments, [
    { kind: "mention", text: "@arc", href: "https://x.com/arc" },
    { kind: "text", text: " & " },
    { kind: "hashtag", text: "#browsers", href: "https://x.com/hashtag/browsers" },
    { kind: "text", text: " are done" },
  ]);
});

test("a reply's leading mentions become the Replying to line", () => {
  assert.deepEqual(splitReplyingTo("@avstorm @x It's a start.", true), { replyingTo: ["avstorm", "x"], body: "It's a start." });
  assert.deepEqual(splitReplyingTo("@avstorm It's a start.", false), { replyingTo: [], body: "@avstorm It's a start." });
});

test("video timestamps read as m:ss", () => {
  assert.equal(videoTimestampLabel(2.8), "0:03");
  assert.equal(videoTimestampLabel(312.6), "5:13");
  assert.equal(videoTimestampLabel(null), null);
});
