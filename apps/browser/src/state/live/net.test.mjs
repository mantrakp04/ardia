import assert from "node:assert/strict";
import { test } from "node:test";

const { request } = await import("./net.ts");

const forbidden = (body, headers = {}) => {
  globalThis.fetch = async () => new Response(JSON.stringify(body), { status: 403, headers });
  return request("https://www.googleapis.com/drive/v3/files").then(
    () => null,
    (e) => e.kind,
  );
};

test("a 403 whose Google error reason is a rate limit is rate limited, not a missing permission", async () => {
  for (const reason of ["rateLimitExceeded", "userRateLimitExceeded"]) {
    assert.equal(await forbidden({ error: { code: 403, errors: [{ domain: "usageLimits", reason }] } }), "rateLimited");
  }
});

test("any other 403 is a missing permission", async () => {
  assert.equal(await forbidden({ error: { code: 403, errors: [{ domain: "global", reason: "insufficientPermissions" }] } }), "forbidden");
  assert.equal(await forbidden("not json"), "forbidden");
});

test("a 403 with no requests left is rate limited, as before", async () => {
  assert.equal(await forbidden({}, { "x-ratelimit-remaining": "0" }), "rateLimited");
});
