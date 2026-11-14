import test from "node:test";
import assert from "node:assert/strict";
import { compareLeads, type LeadSort } from "./lead-sort.ts";
import type { Lead } from "../server/triage/leads";
const rows = [
  {id:1,createdAt:30,author:{followers:null},metrics:{views:null}},
  {id:2,createdAt:20,author:{followers:0},metrics:{views:0}},
  {id:3,createdAt:10,author:{followers:200},metrics:{views:500}},
] as Lead[];
const order = (sort: LeadSort) => [...rows].sort((a,b) => compareLeads(a,b,sort)).map((r) => r.id);
test("Newest remains the default ordering", () => assert.deepEqual(order("newest"), [1,2,3]));
test("Followers and Views sort high to low, with unknowns after known zero", () => {
  assert.deepEqual(order("followers"), [3,2,1]);
  assert.deepEqual(order("views"), [3,2,1]);
});
test("metric ties use newest first and remain deterministic", () => {
  assert.ok(compareLeads({...rows[2]!,createdAt:40}, rows[2], "views") < 0);
  assert.ok(compareLeads(undefined,rows[0],"views") > 0);
});
