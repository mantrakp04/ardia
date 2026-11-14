var ArdiaSyncChecks = (() => {
  const echo = (text) => (globalThis.__host && globalThis.__host.labEcho ? globalThis.__host.labEcho(text) : "echo:" + text);

  const checks = {
    closureInLoop: async () => {
      const counters = [];
      for (let i = 0; i < 3; i++) counters.push(() => i);
      const items = [];
      for (const item of ["a", "b", "c"]) items.push(() => item);
      const keys = [];
      for (const key in { x: 1, y: 2 }) keys.push(() => key);
      const awaited = [];
      for (const item of [1, 2, 3]) {
        await Promise.resolve();
        awaited.push(() => item * 10);
      }
      const nested = [];
      for (let row = 0; row < 2; row++) for (let column = 0; column < 2; column++) nested.push(() => `${row}:${column}`);
      let shadow = "outer";
      {
        let shadow = "inner";
        items.push(() => shadow);
      }
      return { counters: counters.map((f) => f()), items: items.map((f) => f()), keys: keys.map((f) => f()), awaited: awaited.map((f) => f()), nested: nested.map((f) => f()), shadow };
    },

    microtasksAroundAHostCall: async () => {
      const order = [];
      Promise.resolve().then(() => order.push("first then"));
      order.push("before host");
      const echoed = echo("cycle");
      order.push(`after host ${echoed}`);
      Promise.resolve().then(() => order.push("second then"));
      await null;
      order.push("after await");
      const inner = (async () => {
        order.push("inner start");
        await echo("inner");
        order.push("inner after await");
        return "inner done";
      })();
      order.push("outer after inner started");
      order.push(await inner);
      await Promise.all([1, 2].map(async (n) => order.push(`all ${n}`)));
      order.push("end");
      return order;
    },

    sortStability: async () => {
      const rows = [];
      for (let i = 0; i < 40; i++) rows.push({ key: i % 3, id: i });
      const stable = rows.slice().sort((a, b) => a.key - b.key).map((row) => row.id);
      const keys = Object.keys({ b: 1, a: 2, B: 3, _: 4, "10": 5, "9": 6, "é": 7, "é": 8, "~": 9, "Z": 10 }).sort();
      const numbers = [10, 9, 1, 100, 25].sort();
      return { stable, keys, numbers };
    },

    mapAndSetOrder: async () => {
      const map = new Map([["b", 1], ["a", 2], [3, 3]]);
      map.delete("b");
      map.set("b", 4);
      map.set("a", 5);
      const set = new Set(["z", "y", "x"]);
      set.delete("z");
      set.add("z");
      const object = { b: 1, 2: "two", a: 2, 1: "one", "-1": "minus" };
      return { map: [...map.entries()], set: [...set], objectKeys: Object.keys(object), json: JSON.stringify(object) };
    },

    largeIntegers: async () => {
      const wall = 1800000000123;
      return {
        safe: Number.MAX_SAFE_INTEGER,
        pastSafe: Number.MAX_SAFE_INTEGER + 2,
        base36: Math.max(0, Math.floor(wall)).toString(36).padStart(9, "0"),
        parsed: parseInt("00mz6sc8b", 36),
        counter: (46655).toString(36).padStart(3, "0"),
        shifted: (2147483647 + 1) >> 1,
        halved: (0 + 2147483646) >> 1,
        floats: [0.1 + 0.2, 1e21, -0, 1 / 3, 2 ** 53].map((n) => JSON.stringify(n)),
        rounding: [Math.round(2.5), Math.round(-2.5), Math.round((3 + 6) / 2)],
      };
    },

    stringComparison: async () => {
      const words = ["b", "a", "B", "é", "é", "Z", "10", "9", "~", "0", "\u{1F600}", "￿", ""];
      const pairs = [["a", "b"], ["Z", "a"], ["\u{1F600}", "￿"], ["10", "9"], ["abc", "ab"], ["0.9", "0.10"]];
      return {
        sorted: words.slice().sort(),
        less: pairs.map(([x, y]) => x < y),
        indexOf: "0123456789abcdefghijklmnopqrstuvwxyz".indexOf("q"),
        slices: ["mz6sc8b9.00f.device".slice(0, 9), "a.b.c".split("."), "abc".padStart(6, "0")],
        canon: JSON.stringify({ text: "  é \u{1F600}", quote: "\"", nested: { z: [3, { y: 1, x: 2 }] } }),
      };
    },
  };

  class Runner {
    #names;

    constructor(names) {
      this.#names = names;
    }

    async run() {
      const results = {};
      for (const name of this.#names) results[name] = await checks[name]();
      return results;
    }
  }

  return { run: () => new Runner(Object.keys(checks)).run() };
})();
