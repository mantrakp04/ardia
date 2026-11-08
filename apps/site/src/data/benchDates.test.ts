import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { measuredLine, olderThanHeadline } from "./benchDates.ts";

test("one date for every browser: no per-browser line", () => {
  assert.equal(
    measuredLine([
      { name: "Ardia", version: "0.2.46", measured: "2026-10-19" },
      { name: "Dia", version: "1.53.0", measured: "2026-10-19" },
    ]),
    null,
  );
});

test("Ardia measured later than its rivals: newest first, rivals sharing a day share a clause, the year once", () => {
  assert.equal(
    measuredLine([
      { name: "Ardia", version: "0.2.46", measured: "2026-11-09" },
      { name: "Dia", version: "1.53.0", measured: "2026-10-19" },
      { name: "Helium", version: "0.19.3.1", measured: "2026-10-19" },
    ]),
    "Ardia 0.2.46 measured Nov 9 · Dia 1.53.0 and Helium 0.19.3.1 measured Oct 19, 2026",
  );
});

test("dates in different years each carry their year", () => {
  assert.equal(
    measuredLine([
      { name: "Ardia", version: "0.3.0", measured: "2027-01-04" },
      { name: "Dia", version: "1.53.0", measured: "2026-12-20" },
    ]),
    "Ardia 0.3.0 measured Jan 4, 2027 · Dia 1.53.0 measured Dec 20, 2026",
  );
});

test("a row whose Ardia figure predates Ardia's headline run says so; rivals at their own date don't", () => {
  const headline = new Map([
    ["Ardia", "2026-11-09"],
    ["Dia", "2026-10-16"],
  ]);
  assert.equal(
    olderThanHeadline(
      [
        { name: "Ardia", version: "0.2.38-nightly.8", measured: "2026-10-19" },
        { name: "Dia", version: "1.53.0", measured: "2026-10-16" },
      ],
      headline,
    ),
    "Ardia 0.2.38-nightly.8 from Oct 19",
  );
  assert.equal(olderThanHeadline([{ name: "Ardia", version: "0.2.46", measured: "2026-11-09" }], headline), null);
});

test("bench.json dates every browser it lists", () => {
  const bench = JSON.parse(readFileSync(new URL("./bench.json", import.meta.url), "utf8"));
  for (const [key, b] of Object.entries<{ measured?: string }>(bench.browsers))
    assert.match(b.measured ?? "", /^\d{4}-\d{2}-\d{2}$/, `${key} has a measured date`);
  assert.equal(bench.date, Object.values<{ measured: string }>(bench.browsers).map((b) => b.measured).sort().at(-1));
});
