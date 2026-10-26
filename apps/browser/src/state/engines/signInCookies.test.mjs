import assert from "node:assert/strict";
import { test } from "node:test";
import { carriableCookies, cookieAddresses } from "./signInCookies.ts";

const cookie = (patch = {}) => ({
  name: "NetflixId",
  value: "v",
  domain: ".netflix.com",
  path: "/",
  expires: 2_000_000_000,
  session: false,
  httpOnly: true,
  secure: true,
  ...patch,
});

test("cookies are read for the page's own address and its site root, nothing else", () => {
  assert.deepEqual(cookieAddresses("https://www.netflix.com/watch/1?t=2#x"), ["https://www.netflix.com/watch/1?t=2", "https://www.netflix.com/"]);
  assert.deepEqual(cookieAddresses("https://open.spotify.com/"), ["https://open.spotify.com/"]);
  assert.deepEqual(cookieAddresses("file:///Users/a/b.html"), []);
  assert.deepEqual(cookieAddresses("not a url"), []);
});

test("partitioned, nameless and expired cookies stay behind; session cookies come along", () => {
  const now = 1_900_000_000;
  const kept = cookie();
  const session = cookie({ name: "s", session: true, expires: -1 });
  const partitioned = cookie({ name: "p", partitionKey: { topLevelSite: "https://a.com", hasCrossSiteAncestor: false } });
  const opaque = cookie({ name: "o", partitionKeyOpaque: true });
  const expired = cookie({ name: "e", expires: now - 1 });
  const nameless = cookie({ name: "" });
  assert.deepEqual(carriableCookies([kept, session, partitioned, opaque, expired, nameless], now), [kept, session]);
});
