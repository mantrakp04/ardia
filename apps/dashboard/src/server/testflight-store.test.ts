import assert from "node:assert/strict";
import { test } from "node:test";
import { signupStore } from "./testflight-store.ts";

const BASE = "http://filer.test:8888/buckets/testflight/";
const name = (n: number) => `${n.toString(16).padStart(32, "0")}.json`;
const signup = (email: string, website = "") => JSON.stringify({ v: 1, email, website });

type Stored = { body: string; readStatus?: number; deleteStatus?: number; hangs?: boolean };

function filer(objects: Map<string, Stored>) {
  const calls = { list: 0, read: 0, delete: 0 };
  const send = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const object = url.pathname.slice(new URL(BASE).pathname.length);
    if (!object) {
      calls.list++;
      const limit = Number(url.searchParams.get("limit"));
      const after = url.searchParams.get("lastFileName") ?? "";
      const names = [...objects.keys()].sort().filter((n) => n > after);
      const page = names.slice(0, limit);
      return Response.json({
        Entries: page.map((n, i) => ({ FullPath: `/buckets/testflight/${n}`, Mtime: new Date(1_800_000_000_000 + i).toISOString(), FileSize: Buffer.byteLength(objects.get(n)!.body) })),
        LastFileName: page.at(-1) ?? "",
        ShouldDisplayLoadMore: names.length > page.length,
      });
    }
    const stored = objects.get(object);
    if (init?.method === "DELETE") {
      calls.delete++;
      if (stored?.deleteStatus) return new Response(null, { status: stored.deleteStatus });
      objects.delete(object);
      return new Response(null, { status: 204 });
    }
    calls.read++;
    if (!stored) return new Response("", { status: 404 });
    if (stored.hangs) {
      return new Promise<Response>((_, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true }));
    }
    if (stored.readStatus) return new Response("", { status: stored.readStatus });
    return new Response(stored.body);
  }) as typeof fetch;
  return { send, calls };
}

const store = (objects: Map<string, Stored>, options: { maxObjects?: number; deadlineMs?: number } = {}) => {
  const fake = filer(objects);
  return { ...signupStore({ base: BASE, fetch: fake.send, ...options }), calls: fake.calls };
};

test("a full read pages through the listing and says it is complete", async () => {
  const objects = new Map<string, Stored>();
  for (let i = 0; i < 2500; i++) objects.set(name(i), { body: signup(`user${i}@example.com`) });
  const signups = store(objects);
  const found = await signups.scan();
  assert.equal(found.signups.length, 2500);
  assert.equal(signups.calls.list, 3);
  assert.deepEqual([found.capped, found.timedOut, found.unreadable, found.complete], [false, false, 0, true]);
});

test("removing someone deletes every copy and says so only after a complete read", async () => {
  const objects = new Map<string, Stored>([
    [name(1), { body: signup("alice@example.com") }],
    [name(2), { body: signup("bob@example.com") }],
    [name(3), { body: signup(" ALICE@Example.com") }],
  ]);
  const signups = store(objects);
  assert.deepEqual(await signups.remove("alice@example.com"), { found: true, removed: 2, failed: 0, complete: true });
  assert.deepEqual([...objects.keys()], [name(2)]);
  assert.deepEqual(await signups.remove("alice@example.com"), { found: false, removed: 0, failed: 0, complete: true });
});

test("a copy past the read limit makes a removal incomplete, not done", async () => {
  const objects = new Map<string, Stored>([[name(0), { body: signup("alice@example.com") }]]);
  for (let i = 1; i < 1000; i++) objects.set(name(i), { body: signup(`user${i}@example.com`) });
  objects.set(name(1000), { body: signup("alice@example.com") });
  const signups = store(objects, { maxObjects: 1000 });
  assert.equal((await signups.scan()).capped, true);
  assert.deepEqual(await signups.remove("alice@example.com"), { found: true, removed: 1, failed: 0, complete: false });
  assert.equal(objects.has(name(1000)), true);
});

test("a copy that can't be read is not reported as already gone", async () => {
  const objects = new Map<string, Stored>([
    [name(1), { body: signup("alice@example.com"), readStatus: 500 }],
    [name(2), { body: signup("bob@example.com") }],
  ]);
  const signups = store(objects);
  assert.deepEqual(await signups.remove("alice@example.com"), { found: false, removed: 0, failed: 0, complete: false });
  assert.equal(objects.size, 2);
});

test("a read that runs out of time is incomplete, and so is a removal after it", async () => {
  const objects = new Map<string, Stored>([
    [name(1), { body: signup("alice@example.com") }],
    [name(2), { body: signup("alice@example.com"), hangs: true }],
  ]);
  const signups = store(objects, { deadlineMs: 60 });
  const found = await signups.scan();
  assert.deepEqual([found.timedOut, found.unreadable, found.complete], [true, 1, false]);
  assert.deepEqual(await signups.remove("alice@example.com"), { found: true, removed: 1, failed: 0, complete: false });
  assert.equal(objects.has(name(2)), true);
});

test("a delete the store refuses is counted as failed", async () => {
  const objects = new Map<string, Stored>([
    [name(1), { body: signup("alice@example.com") }],
    [name(2), { body: signup("alice@example.com"), deleteStatus: 500 }],
  ]);
  assert.deepEqual(await store(objects).remove("alice@example.com"), { found: true, removed: 1, failed: 1, complete: true });
  assert.deepEqual([...objects.keys()], [name(2)]);
});

test("clearing junk deletes only junk and leaves people and unread posts alone", async () => {
  const objects = new Map<string, Stored>([
    [name(1), { body: signup("alice@example.com") }],
    [name(2), { body: signup("bot@example.com", "https://spam.example") }],
    [name(3), { body: "email=form@example.com" }],
    [name(4), { body: "" }],
    [name(5), { body: signup("not an email") }],
    [name(6), { body: signup("carol@example.com"), readStatus: 500 }],
    [name(7), { body: "x".repeat(2000) }],
  ]);
  const signups = store(objects);
  assert.deepEqual(await signups.clearJunk(), { found: 5, removed: 5, failed: 0, complete: false });
  assert.deepEqual([...objects.keys()], [name(1), name(6)]);
  assert.equal(signups.calls.delete, 5);
});

test("clearing junk that fills the read limit brings the people behind it into reach", async () => {
  const objects = new Map<string, Stored>();
  for (let i = 0; i < 1000; i++) objects.set(name(i), { body: signup(`bot${i}@example.com`, "spam") });
  for (let i = 1000; i < 1005; i++) objects.set(name(i), { body: signup(`user${i}@example.com`) });
  const signups = store(objects, { maxObjects: 1000 });
  const hidden = await signups.scan();
  assert.deepEqual([hidden.signups.length, hidden.capped, hidden.complete], [0, true, false]);
  assert.deepEqual(await signups.clearJunk(), { found: 1000, removed: 1000, failed: 0, complete: false });
  const reached = await signups.scan();
  assert.deepEqual([reached.signups.length, reached.capped, reached.complete], [5, false, true]);
});
