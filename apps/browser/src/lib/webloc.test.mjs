import assert from "node:assert/strict";
import { test } from "node:test";
import { parseWebloc, weblocText } from "./webloc.ts";

test("a written webloc reads back the same URL, escapes included", () => {
  for (const url of ["https://example.com/", "https://example.com/?a=1&b=<2>", "https://例え.jp/パス"]) assert.equal(parseWebloc(weblocText(url)), url);
});

test("a webloc is the XML property list Finder writes", () => {
  const text = weblocText("https://a.com/?x=1&y=2");
  assert.match(text, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<!DOCTYPE plist/);
  assert.match(text, /<key>URL<\/key>\n\t<string>https:\/\/a.com\/\?x=1&amp;y=2<\/string>/);
});

test("Finder's own weblocs, converted from binary, parse with their entities and whitespace", () => {
  const finder = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>URL</key>
  <string>https://news.ycombinator.com/item?id=1&amp;p=2&#38;q=&#x33;</string>
</dict>
</plist>`;
  assert.equal(parseWebloc(finder), "https://news.ycombinator.com/item?id=1&p=2&q=3");
});

test("a file without a URL key, or with an empty one, is not a link", () => {
  assert.equal(parseWebloc("<plist><dict><key>Name</key><string>x</string></dict></plist>"), null);
  assert.equal(parseWebloc("<plist><dict><key>URL</key><string>  </string></dict></plist>"), null);
  assert.equal(parseWebloc("not a plist"), null);
});

test("a link's identity rides in its webloc and doesn't disturb the URL", async () => {
  const { weblocLinkId } = await import("./webloc.ts");
  const text = weblocText("https://a.example/", "lk1");
  assert.equal(parseWebloc(text), "https://a.example/");
  assert.equal(weblocLinkId(text), "lk1");
  assert.equal(weblocLinkId(weblocText("https://a.example/")), null);
});

test("a URL inside an XML comment is not the link", () => {
  const text = `<plist version="1.0"><dict><!-- <key>URL</key><string>https://evil.example/</string> --><key>URL</key><string>https://real.example/</string></dict></plist>`;
  assert.equal(parseWebloc(text), "https://real.example/");
});
