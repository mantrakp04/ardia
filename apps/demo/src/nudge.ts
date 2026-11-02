import { clickTab } from "../../browser/src/state/sidebar/actions";
import { useBrowser } from "../../browser/src/state/browser/store";
import { focusedWindowOf } from "../../browser/src/state/windows/ui";

const TARGET_TAB = "t_react";
const CURSOR_SIZE = 26;
const ARROW = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${CURSOR_SIZE}" height="${CURSOR_SIZE}"><path d="M5 2.5v17.2l4.3-4.1 2.7 6.2 3-1.3-2.7-6.1h6z" fill="#16130f" stroke="#fffdf8" stroke-width="1.5" stroke-linejoin="round"/></svg>`;

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });

function rowLabel(title: string) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let best: DOMRect | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue?.trim() !== title || !node.parentElement) continue;
    const rect = node.parentElement.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.left < 0 || rect.right > innerWidth || rect.top < 0 || rect.bottom > innerHeight) continue;
    if (!best || rect.left < best.left) best = rect;
  }
  return best;
}

function glide(el: HTMLElement, x: number, y: number, ms: number) {
  return el.animate([{ transform: el.style.transform }, { transform: `translate(${x}px, ${y}px)` }], { duration: ms, easing: "cubic-bezier(0.45, 0, 0.2, 1)", fill: "forwards" }).finished.then(() => {
    el.style.transform = `translate(${x}px, ${y}px)`;
  });
}

export async function playNudge(signal: AbortSignal) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const s = useBrowser.getState();
  const windowId = focusedWindowOf(s);
  const tab = s.tabs[TARGET_TAB];
  const win = windowId ? s.windows[windowId] : undefined;
  if (!windowId || !tab || !win || win.profileId !== tab.profileId || win.activeTabIds[win.profileId] === TARGET_TAB) return;
  const label = rowLabel(tab.title);
  if (!label) return;

  const cursor = document.createElement("div");
  cursor.className = "ardia-nudge";
  cursor.innerHTML = `${ARROW}<span class="ardia-nudge-ring"></span>`;
  const startX = label.left + 150;
  const startY = label.top + 170;
  cursor.style.transform = `translate(${startX}px, ${startY}px)`;
  document.body.append(cursor);
  const remove = () => {
    cursor.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    cursor.remove();
  };
  signal.addEventListener("abort", remove);
  try {
    await cursor.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, fill: "forwards" }).finished;
    await wait(200, signal);
    await glide(cursor, label.left + 18, label.top + label.height / 2 - 4, 900);
    await wait(180, signal);
    cursor.classList.add("pressed");
    await wait(140, signal);
    if (signal.aborted) return;
    clickTab(windowId, TARGET_TAB);
    await wait(220, signal);
    cursor.classList.remove("pressed");
    await wait(900, signal);
    await cursor.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 360, fill: "forwards" }).finished;
  } catch {
    return;
  } finally {
    remove();
  }
}
