export type Check = { name: string; run(): Promise<void> | void };

export function expectEqual<Value>(actual: Value, expected: Value, what: string) {
  const got = JSON.stringify(actual);
  const wanted = JSON.stringify(expected);
  if (got !== wanted) throw new Error(`${what}: got ${got}, wanted ${wanted}`);
}

export function expectTrue(condition: unknown, what: string): asserts condition {
  if (!condition) throw new Error(what);
}
