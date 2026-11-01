import { dismissesPopover } from "./popoverEscape";

const SWALLOWED = ["mousedown", "pointerup", "mouseup", "click", "touchstart", "touchend"] as const;
const SWALLOW_MS = 800;
const TEXT_ENTRY = "input, textarea, [contenteditable=''], [contenteditable='true']";

type Target = Pick<EventTarget, "addEventListener" | "removeEventListener">;

export type DownloadsDismissal = {
  target: Target;
  inside: (node: EventTarget | null) => boolean;
  close: () => void;
  watchPageFocus: (listener: () => void) => () => void;
  activeElement: () => Pick<Element, "matches"> | null;
  now?: () => number;
};

export function startDownloadsDismissal({ target, inside, close, watchPageFocus, activeElement, now = () => performance.now() }: DownloadsDismissal) {
  let swallowUntil = -Infinity;
  const stop = (event: Event) => {
    event.stopImmediatePropagation();
    event.preventDefault();
  };
  const down = (event: Event) => {
    if (inside(event.target)) return;
    swallowUntil = now() + SWALLOW_MS;
    stop(event);
    close();
  };
  const swallow = (event: Event) => {
    if (now() > swallowUntil) return;
    stop(event);
    if (event.type === "click") swallowUntil = -Infinity;
  };
  const key = (event: Event) => {
    if (!dismissesPopover(event as KeyboardEvent, !!activeElement()?.matches(TEXT_ENTRY), false)) return;
    event.preventDefault();
    close();
  };
  target.addEventListener("pointerdown", down, true);
  for (const type of SWALLOWED) target.addEventListener(type, swallow, true);
  target.addEventListener("keydown", key, true);
  const stopPage = watchPageFocus(close);
  return () => {
    target.removeEventListener("pointerdown", down, true);
    for (const type of SWALLOWED) target.removeEventListener(type, swallow, true);
    target.removeEventListener("keydown", key, true);
    stopPage();
  };
}
