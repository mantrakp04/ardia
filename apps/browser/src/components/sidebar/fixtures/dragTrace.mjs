import { readFileSync, writeFileSync } from "node:fs";
import { S, readDrag, gaps, committed, settle } from "./dragScene.mjs";
import { live } from "../../../state/live/store.ts";
import { tileFolderOf } from "../../../state/pins/tileFolders.ts";
import { splitRowPanes } from "../../../state/splits/splits.ts";

export function labeller() {
  const labels = new Map();
  const refresh = () => {
    const s = S();
    for (const t of Object.values(s.tabs)) labels.set(t.id, new URL(t.pinnedUrl || t.url).hostname.split(".")[0]);
    for (const g of Object.values(s.groups)) labels.set(g.id, `G(${g.name})`);
    for (const sp of Object.values(s.splits ?? {})) labels.set(sp.id, `S(${splitRowPanes(s, sp).map((id) => labels.get(id) ?? id).join("+")})`);
    for (const t of Object.values(s.tabs)) {
      const folder = tileFolderOf(t);
      if (folder && !labels.has(folder.id)) labels.set(folder.id, `TF${labels.size}`);
    }
    for (const f of Object.values(live().folders)) if (!labels.has(f.id)) labels.set(f.id, `LF(${f.name})`);
  };
  const name = (value) => {
    refresh();
    const ids = [...labels.keys()].sort((a, b) => b.length - a.length);
    const swap = (str) => ids.reduce((acc, id) => (acc.includes(id) ? acc.split(id).join(labels.get(id)) : acc), str);
    const walk = (v) =>
      typeof v === "string" ? swap(v) : Array.isArray(v) ? v.map(walk) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [swap(k), walk(x)])) : v;
    return walk(JSON.parse(JSON.stringify(value ?? null)));
  };
  return { name };
}

export function recorder(c, windowId) {
  const { name } = labeller();
  const steps = [];
  let last = {};
  const push = (label, state) => {
    const changed = Object.fromEntries(Object.entries(state).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(last[k])));
    last = { ...last, ...state };
    steps.push({ step: label, ...changed });
  };
  const snap = (label) => {
    const r = readDrag(c);
    push(label, name({ ...r, ...r.marks, marks: undefined, gaps: gaps(c) }));
  };
  return {
    steps,
    snap,
    async begin(key, x, y) {
      await c.begin(key, x, y);
      snap(`begin ${name(key)} ${x},${y}`);
    },
    move(x, y) {
      c.move(x, y);
      snap(`move ${x},${y}`);
    },
    async end(commit) {
      c.end(commit);
      await settle();
      snap(`end ${commit}`);
      push(`committed`, name({ committed: committed(windowId) }));
    },
    name,
  };
}

export function golden(name) {
  const GOLDEN = new URL(`./${name}.json`, import.meta.url);
  const update = process.env.UPDATE_DRAG_GOLDEN === "1";
  const stored = update ? {} : JSON.parse(readFileSync(GOLDEN, "utf8"));
  const recorded = {};
  return {
    check(t, title, steps) {
      if (update) recorded[title] = steps;
      else t.assert.deepStrictEqual(steps, stored[title], `${title}: trace differs from the recorded one`);
    },
    write() {
      if (!update) return;
      const all = { ...(() => { try { return JSON.parse(readFileSync(GOLDEN, "utf8")); } catch { return {}; } })(), ...recorded };
      writeFileSync(GOLDEN, `${JSON.stringify(Object.fromEntries(Object.entries(all).sort(([a], [b]) => a.localeCompare(b))), null, 1)}\n`);
    },
  };
}
