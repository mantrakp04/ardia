import { switchOn } from "../../platform/killSwitches";
import type { BrowserState } from "../browser/store";

const focusedWindowFirstOn = () => switchOn("focusedWindowFirst");

type WindowOpen = { id: string; focus: boolean; behind?: string };

export function windowOpens(s: Pick<BrowserState, "windows" | "windowOrder" | "ui">, ids: string[], launching: boolean): WindowOpen[] {
  const focused = s.ui.focusedWindowId && s.windows[s.ui.focusedWindowId] ? s.ui.focusedWindowId : null;
  const wanted = new Set(ids);
  const order = s.windowOrder.filter((id) => wanted.has(id) && id !== focused);
  if (!focused || !wanted.has(focused)) return order.map((id) => ({ id, focus: false }));
  if (!launching || !focusedWindowFirstOn()) return [...order.map((id) => ({ id, focus: false })), { id: focused, focus: true }];
  return [{ id: focused, focus: true }, ...order.map((id) => ({ id, focus: false, behind: focused }))];
}
