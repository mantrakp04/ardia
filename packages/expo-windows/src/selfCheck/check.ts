export type Check = { name: string; run(): Promise<void> | void };

const distinct = (_key: string, value: unknown) => {
  if (value === undefined) return "<undefined>";
  if (typeof value === "number" && !Number.isFinite(value)) return `<${String(value)}>`;
  if (value instanceof Map) return { "<Map>": [...value] };
  if (value instanceof Set) return { "<Set>": [...value] };
  return value;
};

export function expectEqual<Value>(actual: Value, expected: Value, what: string) {
  const got = JSON.stringify(actual, distinct);
  const wanted = JSON.stringify(expected, distinct);
  if (got !== wanted) throw new Error(`${what}: got ${got}, wanted ${wanted}`);
}

export function expectTrue(condition: unknown, what: string): asserts condition {
  if (!condition) throw new Error(what);
}
