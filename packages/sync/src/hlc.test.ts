import assert from "node:assert/strict";
import { test } from "node:test";
import { Clock, hlcWall } from "./hlc.ts";

const stamp = (wall: number, counter: number, device: string) =>
  `${wall.toString(36).padStart(9, "0")}.${counter.toString(36).padStart(4, "0")}.${device}`;

test("a clock held back by a peer far ahead keeps its stamps in order past the counter's last digit", () => {
  const wall = 1_790_000_000_000;
  const last = 36 ** 4 - 1;
  const seen = stamp(wall, last - 1, "b");
  const clock = new Clock("a", seen, () => wall - 86_400_000);
  const stamps = [seen, clock.tick(), clock.tick(), clock.tick(), clock.tick()];
  for (let i = 1; i < stamps.length; i++) assert.ok(stamps[i - 1]! < stamps[i]!, `${stamps[i - 1]} < ${stamps[i]}`);
  for (const h of stamps) assert.equal(h.split(".")[1]!.length, 4, h);
  assert.equal(hlcWall(stamps.at(-1)!), wall + 1);
});

test("a counter past the last digit from an older peer is still beaten by the next tick", () => {
  const wall = 1_790_000_000_000;
  const seen = stamp(wall, 36 ** 4 + 5, "b");
  const clock = new Clock("a", seen, () => wall);
  const next = clock.tick();
  assert.ok(seen < next, `${seen} < ${next}`);
  assert.equal(next.split(".")[1]!.length, 4, next);
});
