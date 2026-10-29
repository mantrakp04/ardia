import { classifySitePanel } from "./assertions.mjs";
import { js, until } from "./util.mjs";

export async function revealToolbar(shell) {
  const width = await shell.eval("innerWidth");
  for (const [x, y] of [[width / 2, 60], [width / 2, 8], [width / 2, 26]]) {
    await shell.session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export async function visibleByLabel(shell, prefix) {
  return shell.eval(`(() => { const n = [...document.querySelectorAll('[aria-label]')].find(n => n.getAttribute('aria-label').startsWith(${js(prefix)}) && n.getBoundingClientRect().width > 0); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: n.getAttribute('aria-label') }; })()`);
}

export async function clickLabel(shell, prefix, options = {}) {
  let r = await visibleByLabel(shell, prefix);
  if (!r) {
    await revealToolbar(shell);
    r = await until(() => visibleByLabel(shell, prefix), { timeout: options.timeout ?? 6000, label: `control labelled ${prefix}` });
  }
  await shell.mouse(r.x, r.y, options);
  return r;
}

export const CONNECTION_CHIPS = ["Connection information unavailable", "Not Fully Secure", "Not Secure", "Secure", "Local Page"];

export async function sitePanelText(shell) {
  await clickLabel(shell, "Site Controls");
  const chip = await until(async () => {
    const lines = (await shell.text()).split("\n").map((line) => line.trim());
    return CONNECTION_CHIPS.find((title) => lines.includes(title)) ?? false;
  }, { timeout: 8000, label: "site panel connection chip" });
  await shell.clickText(chip);
  const text = await until(async () => {
    const text = await shell.text();
    return classifySitePanel(text).level ? text : false;
  }, { timeout: 8000, label: "site panel connection row" });
  await shell.key("Escape", { code: "Escape", keyCode: 27 });
  await new Promise((resolve) => setTimeout(resolve, 300));
  return text;
}

export async function openHistoryMenu(shell, direction) {
  await clickLabel(shell, direction < 0 ? "Go Back" : "Go Forward", { button: "right" });
}

export async function chooseHistoryEntry(shell, direction, title) {
  await openHistoryMenu(shell, direction);
  await shell.clickText(title, { timeout: 6000 });
}

export async function dropElements(shell) {
  const { result } = await shell.session.send("Runtime.evaluate", { expression: "[...document.querySelectorAll('*')].filter(n => { const r = n.getBoundingClientRect(); return r.width > 40 && r.height > 40; })", returnByValue: false });
  const { result: props } = await shell.session.send("Runtime.getProperties", { objectId: result.objectId, ownProperties: true });
  const found = [];
  for (const prop of props) {
    if (!/^\d+$/.test(prop.name) || !prop.value?.objectId) continue;
    const { listeners } = await shell.session.send("DOMDebugger.getEventListeners", { objectId: prop.value.objectId });
    if (!listeners.some((l) => l.type === "drop")) continue;
    const { result: box } = await shell.session.send("Runtime.callFunctionOn", { objectId: prop.value.objectId, functionDeclaration: "function() { const r = this.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; }", returnByValue: true });
    found.push(box.value);
  }
  await shell.session.send("Runtime.releaseObject", { objectId: result.objectId }).catch(() => {});
  return found;
}

export function sidebarDropPoint(areas, viewportWidth) {
  const sidebar = areas.filter((a) => a.left < viewportWidth / 3 && a.width < viewportWidth / 2).sort((a, b) => b.height - a.height)[0];
  if (!sidebar) return null;
  return { x: sidebar.left + sidebar.width / 2, y: sidebar.top + sidebar.height * 0.75, area: sidebar };
}

export async function dispatchDrop(shell, point, data) {
  const base = { x: point.x, y: point.y, modifiers: 0 };
  const dragData = { items: data.items ?? [], files: data.files, dragOperationsMask: 1 };
  await shell.session.send("Input.dispatchDragEvent", { type: "dragEnter", ...base, data: dragData });
  await shell.session.send("Input.dispatchDragEvent", { type: "dragOver", ...base, data: dragData });
  await shell.session.send("Input.dispatchDragEvent", { type: "drop", ...base, data: dragData });
}
