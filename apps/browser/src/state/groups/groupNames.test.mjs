import assert from "node:assert/strict";
import { test } from "node:test";
const { autoGroupName, siteKey } = await import("./groupNames.ts");

test("a group of pages on an IP address is named after the address, not one of its numbers", () => {
  assert.equal(autoGroupName([{ url: "http://127.0.0.1:9471/d", title: "" }]), "127.0.0.1");
  assert.equal(autoGroupName([{ url: "http://[::1]:8080/", title: "" }]), "[::1]");
  assert.equal(siteKey("http://10.0.0.2/a"), "10.0.0.2");
  assert.equal(autoGroupName([{ url: "https://news.bbc.co.uk/x", title: "" }]), "Bbc");
});
