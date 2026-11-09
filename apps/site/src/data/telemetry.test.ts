import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { AUTO_EVENTS, REPLAY_BODY_LIMIT_MB, REPLAY_MAX_CHUNK_BYTES, REPLAY_SEQ_DIGITS, REPLAY_SESSION, SITE_EVENTS } from "./telemetry.ts";

const site = new URL("../../", import.meta.url);
const sources = execFileSync("git", ["ls-files", "src"], { cwd: site, encoding: "utf8" })
  .split("\n")
  .filter((file) => /\.(astro|ts)$/.test(file) && !file.endsWith(".test.ts"))
  .map((file) => readFileSync(new URL(file, site), "utf8"))
  .join("\n");
const sent = new Set([...sources.matchAll(/data-track="(\w+)"|capture\(\s*"(\$?\w+)"/g)].map((m) => m[1] ?? m[2]));

test("every event the site sends is in the vocabulary", () => {
  const known = new Set<string>([...SITE_EVENTS, ...AUTO_EVENTS]);
  assert.deepEqual([...sent].filter((event) => !known.has(event)), []);
});

test("every site event in the vocabulary is still sent somewhere", () => {
  assert.deepEqual(SITE_EVENTS.filter((event) => !sent.has(event)), []);
});

test("nginx takes the replay uploads the recorder makes", () => {
  const nginx = readFileSync(new URL("../../infra/site/nginx.conf", site), "utf8");
  const location = nginx.match(/location ~ "\^\/otel\/replay\/\(\?<replay_session>(.+?)\)\/\(\?<replay_seq>\[0-9\]\{1,(\d+)\}\)[^"]*" \{(.*?)\n  \}/s);
  assert.ok(location, "the replay location in infra/site/nginx.conf");
  const [, session, digits, body] = location;
  assert.equal(`^${session}$`, REPLAY_SESSION.source);
  assert.equal(Number(digits), REPLAY_SEQ_DIGITS);
  assert.match(body, new RegExp(`client_max_body_size ${REPLAY_BODY_LIMIT_MB}m;`));
  assert.ok(REPLAY_MAX_CHUNK_BYTES < REPLAY_BODY_LIMIT_MB * 1_000_000);
});
