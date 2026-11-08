import assert from "node:assert/strict";
import { test } from "node:test";
import { anonymousIdentity, hslHex, IDENTITY_ADJECTIVES, IDENTITY_ANIMALS } from "./anonymousIdentity.ts";

const HEX = /^#[0-9a-f]{6}$/;

const luminance = (color: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

const saturation = (color: string) => {
  const channels = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
  const max = Math.max(...channels);
  const min = Math.min(...channels);
  return max === 0 ? 0 : (max - min) / max;
};

test("128 distinct, capitalised, single-word adjectives and animals", () => {
  for (const list of [IDENTITY_ADJECTIVES, IDENTITY_ANIMALS]) {
    assert.equal(list.length, 128);
    assert.equal(new Set(list).size, 128);
    for (const word of list) assert.match(word, /^[A-Z][a-z]+$/);
  }
});

test("the same id always gives the same name and avatar, whatever its case or spacing", () => {
  const id = "3f2a9c1e-5b7d-4e8f-a1b2-c3d4e5f60718";
  const first = anonymousIdentity(id);
  assert.deepEqual(anonymousIdentity(id), first);
  assert.deepEqual(anonymousIdentity(` ${id.toUpperCase()} `), first);
});

test("pinned values keep every runtime (app, feedback service, dashboard) in agreement", () => {
  const pinned = anonymousIdentity("pinned-install-id");
  assert.equal(pinned.name, PINNED.name);
  assert.deepEqual(pinned.avatar, PINNED.avatar);
});

test("names are adjective plus animal from the lists", () => {
  for (let i = 0; i < 500; i++) {
    const [adjective, animal, ...rest] = anonymousIdentity(crypto.randomUUID()).name.split(" ");
    assert.equal(rest.length, 0);
    assert.ok((IDENTITY_ADJECTIVES as readonly string[]).includes(adjective!));
    assert.ok((IDENTITY_ANIMALS as readonly string[]).includes(animal!));
  }
});

test("names spread over the whole space: 20k random ids use most words and rarely collide", () => {
  const names = new Set<string>();
  const adjectives = new Set<string>();
  const animals = new Set<string>();
  for (let i = 0; i < 20_000; i++) {
    const { name } = anonymousIdentity(crypto.randomUUID());
    names.add(name);
    const [a, b] = name.split(" ");
    adjectives.add(a!);
    animals.add(b!);
  }
  assert.equal(adjectives.size, 128);
  assert.equal(animals.size, 128);
  assert.ok(names.size > 7_500, `only ${names.size} distinct names`);
});

test("avatars are three saturated, mid-light hex colours and a whole angle", () => {
  for (let i = 0; i < 2_000; i++) {
    const { colors, angle } = anonymousIdentity(crypto.randomUUID()).avatar;
    assert.equal(colors.length, 3);
    for (const color of colors) {
      assert.match(color, HEX);
      assert.ok(saturation(color) > 0.45, `${color} is washed out`);
      const l = luminance(color);
      assert.ok(l > 0.12 && l < 0.9, `${color} is too dark or too light`);
    }
    assert.ok(Number.isInteger(angle) && angle >= 0 && angle < 360);
  }
});

test("hslHex matches known colours", () => {
  assert.equal(hslHex(0, 100, 50), "#ff0000");
  assert.equal(hslHex(120, 100, 50), "#00ff00");
  assert.equal(hslHex(240, 100, 50), "#0000ff");
  assert.equal(hslHex(0, 0, 100), "#ffffff");
});

const PINNED = { name: "Ocean Elk", avatar: { colors: ["#c950f1", "#637bf2", "#1ae0cf"], angle: 283 } };
