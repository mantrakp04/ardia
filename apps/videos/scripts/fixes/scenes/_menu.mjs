import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const CTRL = 262144;

export const ctrlClick = (x, y) => `const N0 = () => ac.engine.call("windows.list").then((ws) => ws.filter((w) => w.hasRoot)[0].window);
return N0().then((n) => ac.engine.call("windows.dev", { window: n, action: "mouse:moved:${x},${y}" }).then(() => ac.engine.call("windows.dev", { window: n, action: "mouse:down:${x},${y},1,${CTRL}" })).then(() => ac.engine.call("windows.dev", { window: n, action: "mouse:up:${x},${y},1,${CTRL}" }))).then(() => "ok");`;

export async function dumpAppMenu(instance, open) {
  const file = join(instance.data, "menu.json");
  rmSync(file, { force: true });
  rmSync(`${file}.pick`, { force: true });
  await instance.eval(open);
  for (const end = Date.now() + 5000; !existsSync(file) && Date.now() < end; ) await sleep(100);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
}

export function pickAppMenu(instance, id) {
  if (id) writeFileSync(join(instance.data, "menu.json.pick"), id);
}

export function rowOf(items, id) {
  let rows = 0;
  for (const item of items) {
    if (item.id === id) return { rows, item };
    if (!item.separator) rows += 1;
  }
  return null;
}

export const MENU_GEOMETRY = `const MG = { row: 22, separator: 11, pad: 5 };
const isSep = (i) => !!i.separator || i.type === 4 || (i.label === "" && i.title === undefined);
const titleOfItem = (i) => i.title !== undefined ? i.title : i.label;
const menuWidth = (list) => Math.max(150, Math.round(Math.max(...list.filter((i) => !isSep(i)).map((i) => String(titleOfItem(i) || "").length)) * 7.2 + 64));
const rowTop = (list, index, top) => top + MG.pad + list.slice(0, index).reduce((s, i) => s + (isSep(i) ? MG.separator : MG.row), 0);
const rowCentre = (list, index, top) => rowTop(list, index, top) + MG.row / 2;
const geometry = (list, x, y, subIndex) => {
  const width = menuWidth(list);
  const sub = subIndex >= 0 ? (list[subIndex].children || []) : [];
  return { ...MG, x, y, width, subX: x + width - 4, subY: subIndex >= 0 ? rowTop(list, subIndex, y) - MG.pad : y, subWidth: sub.length ? menuWidth(sub) : 0 };
};`;
