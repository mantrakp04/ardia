import assert from "node:assert/strict";
import { test } from "node:test";
import { legacyConditions, parseConditions, withPreset } from "../lib/replay-query";
import { buildReplayList, REPLAY_PAGE_SIZE } from "./replay-sql";

const FROM = Date.UTC(2026, 10, 1);
const build = (raw: unknown, match: "all" | "any" = "all", page = 1) => buildReplayList({ from: FROM, conditions: parseConditions(raw), match, sort: "newest", page });
const whereOf = (sql: string) => sql.slice(sql.lastIndexOf("WHERE "), sql.lastIndexOf("ORDER BY")).trim();

test("no conditions match every session", () => {
  const { sql, params } = build([]);
  assert.equal(whereOf(sql), "WHERE 1");
  assert.deepEqual(params, {});
});

test("user strings are bound as parameters, never written into the SQL", () => {
  const hostile = "x') OR 1=1 -- {p9:String} `;DROP TABLE telemetry.events";
  const { sql, params } = build([
    ["first_page", "contains", hostile],
    ["referrer", "is", hostile],
    ["country", "is_not", hostile],
  ]);
  assert.ok(!sql.includes("OR 1=1"));
  assert.ok(!sql.includes("DROP TABLE"));
  assert.deepEqual(Object.values(params), [hostile, hostile, hostile].map((v) => v.slice(0, 200)));
  assert.match(whereOf(sql), /positionCaseInsensitiveUTF8\(first_url, \{p0:String\}\) > 0/);
  assert.match(whereOf(sql), /lower\(referrer\) = lower\(\{p1:String\}\)/);
  assert.match(whereOf(sql), /lower\(country\) != lower\(\{p2:String\}\)/);
});

test("AND and OR join the conditions", () => {
  const all = build([["length", "gte", 60], ["customize", "is", "yes"], ["clicks", "gt", 0]]);
  assert.equal(whereOf(all.sql), "WHERE (duration_s >= {p0:Float64}) AND (customized = 1) AND (clicks > {p1:Float64})");
  assert.deepEqual(all.params, { p0: 60, p1: 0 });
  const any = build([["download", "is", "no"], ["customize", "is", "yes"]], "any");
  assert.equal(whereOf(any.sql), "WHERE (downloaded = 0) OR (customized = 1)");
});

test("unknown fields, operators and bad values are dropped", () => {
  const conditions = parseConditions([
    ["properties['x']", "is", "1"],
    ["constructor", "is", "1"],
    ["__proto__", "is", "1"],
    ["length", "toString", "1"],
    ["length", "LIKE", "1"],
    ["length", "gte", "1; DROP"],
    ["length", "gte", -5],
    ["download", "is", "maybe"],
    ["started", "after", "yesterday"],
    ["device", "is", ""],
    { field: "pages", op: "gte", value: "2" },
    ["pages", "gte", 2],
  ]);
  assert.deepEqual(conditions, [{ field: "pages", op: "gte", value: 2 }]);
});

test("any page and path starts with read the session's URLs", () => {
  const { sql, params } = build([["any_page", "starts_with", "/release-notes"], ["first_page", "not_contains", "utm_"]]);
  assert.ok(sql.includes("groupUniqArray(200)(properties['$current_url']) AS urls"));
  assert.match(whereOf(sql), /arrayExists\(u -> startsWith\(lower\(path\(u\)\), lower\(\{p0:String\}\)\), urls\)/);
  assert.match(whereOf(sql), /NOT \(positionCaseInsensitiveUTF8\(first_url, \{p1:String\}\) > 0\)/);
  assert.deepEqual(params, { p0: "/release-notes", p1: "utm_" });
  assert.ok(!build([["pages", "gte", 1]]).sql.includes("groupUniqArray"));
});

test("started, size and paging", () => {
  const { sql, params } = build([["started", "after", "2026-11-02T10:30"], ["size", "lt", 500]], "all", 3);
  assert.equal(whereOf(sql), "WHERE (start_ms >= {p0:Int64}) AND (bytes / 1024 < {p1:Float64})");
  assert.deepEqual(params, { p0: Date.UTC(2026, 10, 2, 10, 30), p1: 500 });
  assert.ok(sql.endsWith(`LIMIT ${REPLAY_PAGE_SIZE} OFFSET ${2 * REPLAY_PAGE_SIZE}`));
});

test("Customize it clicks come from the site's demo_customize event", () => {
  const { sql } = build([]);
  assert.ok(sql.includes("max(event = 'demo_customize') AS customized"));
});

test("quick filters are presets of the builder", () => {
  const legacy = legacyConditions({ min: "60", clicks: "1", device: "Mac", url: "release", download: "yes" });
  assert.deepEqual(legacy, [
    { field: "length", op: "gte", value: 60 },
    { field: "clicks", op: "gt", value: 0 },
    { field: "device", op: "is", value: "Mac" },
    { field: "first_page", op: "contains", value: "release" },
    { field: "download", op: "is", value: "yes" },
  ]);
  const changed = withPreset(legacy, "length", "gte", 300);
  assert.deepEqual(changed[0], { field: "length", op: "gte", value: 300 });
  assert.equal(withPreset(changed, "device", "is", undefined).length, 4);
  assert.equal(withPreset([], "customize", "is", "yes").length, 1);
});
