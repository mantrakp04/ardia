import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { CdpError, connectCdp, evaluate } from "../lib/cdp.mjs";
import { startMockCdp } from "./mock-cdp.mjs";

describe("CDP client", () => {
  let mock;
  before(async () => {
    mock = await startMockCdp({
      handlers: {
        "Echo.ping": (params) => ({ pong: params.value }),
        "Echo.fail": () => { throw new Error("boom"); },
        "Echo.never": () => mock.NO_REPLY,
        "Echo.later": (params, { peer }) => { setTimeout(() => peer.event("Echo.done", { value: params.value }), 20); return {}; },
        "Runtime.evaluate": (params) => params.expression === "throw" ? { exceptionDetails: { text: "Uncaught", exception: { description: "Error: thrown" } } } : { result: { type: "number", value: 42 } },
      },
    });
  });
  after(() => mock.close());

  it("matches replies to requests", async () => {
    const session = await connectCdp(mock.url());
    const [a, b] = await Promise.all([session.send("Echo.ping", { value: 1 }), session.send("Echo.ping", { value: 2 })]);
    assert.deepEqual([a.pong, b.pong], [1, 2]);
    await session.close();
  });

  it("turns protocol errors into CdpError", async () => {
    const session = await connectCdp(mock.url());
    await assert.rejects(session.send("Echo.fail"), (error) => error instanceof CdpError && /boom/.test(error.message) && error.method === "Echo.fail");
    await session.close();
  });

  it("times out a request that never answers", async () => {
    const session = await connectCdp(mock.url());
    await assert.rejects(session.send("Echo.never", {}, { timeout: 100 }), /timed out after 100 ms/);
    await session.close();
  });

  it("waits for events with a predicate", async () => {
    const session = await connectCdp(mock.url());
    const waiting = session.waitFor("Echo.done", (p) => p.value === 7, 2000);
    await session.send("Echo.later", { value: 7 });
    assert.deepEqual(await waiting, { value: 7 });
    await assert.rejects(session.waitFor("Echo.done", () => true, 50), /Timed out after 50 ms/);
    await session.close();
  });

  it("rejects pending work when the peer closes", async () => {
    const session = await connectCdp(mock.url());
    const pending = session.send("Echo.never", {}, { timeout: 5000 });
    const waiting = session.waitFor("Never.happens", () => true, 5000);
    mock.peers.at(-1).close();
    await assert.rejects(pending, /closed/);
    await assert.rejects(waiting, /closed/);
    assert.equal(session.closed, true);
    await assert.rejects(session.send("Echo.ping"), /closed before Echo.ping/);
  });

  it("reports evaluation exceptions", async () => {
    const session = await connectCdp(mock.url());
    assert.equal(await evaluate(session, "41 + 1"), 42);
    await assert.rejects(evaluate(session, "throw"), /Error: thrown/);
    await session.close();
  });

  it("fails fast when nothing listens", async () => {
    await assert.rejects(connectCdp("ws://127.0.0.1:9/devtools/browser/x", { timeout: 2000 }), /failed|timed out/);
  });
});
