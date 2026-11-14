import assert from "node:assert/strict";
import test from "node:test";
import { sfSymbol } from "./sfSymbols.ts";

test("a Mac profile's SF Symbol becomes the app's symbol when it has one, as ArdiaSymbols.named does", () => {
  const known = (symbol: string) => ["laptop", "starFill", "folderFill"].includes(symbol);
  assert.equal(sfSymbol("laptopcomputer", known), "laptop");
  assert.equal(sfSymbol("star.fill", known), "starFill");
  assert.equal(sfSymbol("briefcase.fill", known), null);
  assert.equal(sfSymbol("globe", known), null);
  assert.equal(sfSymbol(null, known), null);
});
