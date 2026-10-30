import assert from "node:assert/strict";
import { test } from "node:test";
const { useBoostStore } = await import("../boosts/store.ts");
const actions = await import("../boosts/actions.ts");
const { Clock, emptyScope, syncScope } = await import("@ardia/sync");
const { boostsAdapter } = await import("./boostsAdapter.ts");

const files = new Map();
const transport = {
  write: async (scope, payload) => {
    const id = `f${files.size + 1}`;
    files.set(id, { scope, payload });
    return id;
  },
  read: async (scope, known) => {
    const shown = [...files].filter(([, f]) => f.scope === scope);
    return { files: shown.filter(([id]) => !known.includes(id)).map(([id, f]) => ({ id, payload: f.payload })), pending: [], damaged: [], present: shown.map(([id]) => id) };
  },
  remove: async () => {},
};

const mac = (id) => ({ id, scope: emptyScope(), clock: new Clock(id), mine: {} });
const sync = async (m) => {
  useBoostStore.setState({ boostsByProfile: m.mine }, true);
  await syncScope({ scope: "p", state: m.scope, transport, adapters: [boostsAdapter("default")], clock: m.clock, device: m.id });
  m.mine = useBoostStore.getState().boostsByProfile;
};
const list = (m) => m.mine.default ?? [];

test("a boost made on one Mac appears on the other, edits and deletes follow", async () => {
  const a = mac("a");
  const b = mac("b");
  useBoostStore.setState({ boostsByProfile: {} }, true);
  const boost = actions.createBoost("default", "example.com");
  a.mine = useBoostStore.getState().boostsByProfile;
  await sync(a);
  await sync(b);
  assert.deepEqual(list(b).map((x) => x.id), [boost.id]);
  assert.deepEqual(list(b)[0], list(a)[0]);

  useBoostStore.setState({ boostsByProfile: b.mine }, true);
  actions.updateBoost("default", boost.id, { zaps: [".ad"], subdomains: true });
  b.mine = useBoostStore.getState().boostsByProfile;
  await sync(b);
  await sync(a);
  assert.deepEqual(list(a)[0].zaps, [".ad"]);
  assert.equal(list(a)[0].subdomains, true);

  useBoostStore.setState({ boostsByProfile: a.mine }, true);
  actions.deleteBoost("default", boost.id);
  a.mine = useBoostStore.getState().boostsByProfile;
  await sync(a);
  await sync(b);
  assert.deepEqual(list(b), []);
});

test("a boost made on each Mac before they meet ends up on both", async () => {
  files.clear();
  const a = mac("a");
  const b = mac("b");
  useBoostStore.setState({ boostsByProfile: {} }, true);
  actions.createBoost("default", "one.com");
  a.mine = useBoostStore.getState().boostsByProfile;
  useBoostStore.setState({ boostsByProfile: {} }, true);
  actions.createBoost("default", "two.com");
  b.mine = useBoostStore.getState().boostsByProfile;
  await sync(a);
  await sync(b);
  await sync(a);
  assert.deepEqual(list(a).map((x) => x.domain).sort(), ["one.com", "two.com"]);
  assert.deepEqual(list(b).map((x) => x.domain).sort(), ["one.com", "two.com"]);
});

test("a record that isn't a valid boost is ignored", async () => {
  files.clear();
  const a = mac("a");
  await syncScope({
    scope: "p",
    state: a.scope,
    transport: { ...transport, read: async () => ({ files: [], pending: [], damaged: [], present: [] }) },
    adapters: [{ prefix: "boost:", extract: () => ({ values: new Map([["boost:bad", { domain: 3 }]]) }), apply: () => {} }],
    clock: a.clock,
    device: "a",
  });
  const b = mac("b");
  await sync(b);
  assert.deepEqual(list(b), []);
});
