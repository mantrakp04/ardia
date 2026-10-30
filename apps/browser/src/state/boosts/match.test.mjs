import assert from "node:assert/strict";
import { test } from "node:test";
const { boostDomain, boostMatchesHost, boostsForHost } = await import("./match.ts");

const boost = (domain, subdomains = false, enabled = true) => ({ domain, subdomains, enabled });

test("a boost covers its domain and the www variant", () => {
  assert.ok(boostMatchesHost(boost("example.com"), "example.com"));
  assert.ok(boostMatchesHost(boost("example.com"), "www.example.com"));
  assert.ok(boostMatchesHost(boost("example.com"), "WWW.Example.com."));
});

test("other subdomains need the toggle", () => {
  assert.equal(boostMatchesHost(boost("example.com"), "dashboard.example.com"), false);
  assert.ok(boostMatchesHost(boost("example.com", true), "dashboard.example.com"));
  assert.ok(boostMatchesHost(boost("example.com", true), "a.b.example.com"));
});

test("lookalike hosts never match", () => {
  assert.equal(boostMatchesHost(boost("example.com", true), "notexample.com"), false);
  assert.equal(boostMatchesHost(boost("example.com", true), "example.com.evil.test"), false);
  assert.equal(boostMatchesHost(boost("example.com"), ""), false);
  assert.equal(boostMatchesHost(boost(""), "example.com"), false);
});

test("a boost made on www gets the bare domain", () => {
  assert.equal(boostDomain("www.example.com"), "example.com");
  assert.equal(boostDomain("dashboard.example.com"), "dashboard.example.com");
});

test("only enabled boosts apply", () => {
  const list = [boost("example.com"), boost("example.com", false, false), boost("other.com")];
  assert.equal(boostsForHost(list, "www.example.com").length, 1);
});
