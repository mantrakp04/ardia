import assert from "node:assert/strict";
import { test } from "node:test";
import { endpoints, request } from "./net.ts";
import { LiveError } from "./types.ts";

test("GitLab uses the API v4 base for a site", () => {
  assert.equal(endpoints.gitlab("https://gitlab.com///"), "https://gitlab.com/api/v4");
});

test("HTTP response errors retain their status", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const status of [401, 403, 429, 404]) {
      globalThis.fetch = async () => new Response("rejected", { status });
      await assert.rejects(request("https://gitlab.example/api"), (error) => error instanceof LiveError && error.status === status);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
