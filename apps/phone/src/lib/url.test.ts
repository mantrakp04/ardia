import assert from "node:assert/strict";
import test from "node:test";
import { displayHost } from "./url.ts";

test("a page suggestion's detail is its host, as SearchInput.displayHost and BrowserUrl.displayHost show it", () => {
  assert.equal(displayHost("www.google.com", "https://www.google.com/search?q=otters%20cafe&sei=Mq"), "google.com");
  assert.equal(displayHost("en.wikipedia.org", "https://en.wikipedia.org/wiki/Otter"), "en.wikipedia.org");
  assert.equal(displayHost("", "about:blank"), "about:blank");
});
