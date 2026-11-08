import assert from "node:assert/strict";
import { test } from "node:test";
import { bitwardenServer, serverChoiceOf } from "./servers.ts";

test("a missing or malformed self-hosted address gives no server", () => {
  assert.equal(bitwardenServer("self", ""), null);
  assert.equal(bitwardenServer("self", "   "), null);
  assert.equal(bitwardenServer("self", "not a url"), null);
  assert.equal(bitwardenServer("self", "intranet"), null);
});

test("self-hosted addresses get https and lose trailing slashes", () => {
  assert.equal(bitwardenServer("self", "vault.example.com/"), "https://vault.example.com");
  assert.equal(bitwardenServer("self", "http://localhost:8080"), "http://localhost:8080");
  assert.equal(bitwardenServer("self", "https://pw.example.org/vaultwarden"), "https://pw.example.org/vaultwarden");
});

test("the hosted regions map to their servers and back", () => {
  assert.equal(bitwardenServer("us", "ignored"), null);
  assert.equal(bitwardenServer("eu", ""), "https://vault.bitwarden.eu");
  assert.equal(serverChoiceOf(undefined), "us");
  assert.equal(serverChoiceOf("https://vault.bitwarden.com"), "us");
  assert.equal(serverChoiceOf("https://vault.bitwarden.eu/"), "eu");
  assert.equal(serverChoiceOf("https://vault.example.com"), "self");
});
