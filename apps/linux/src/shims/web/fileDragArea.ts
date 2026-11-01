import { createFileDragGesture } from "../../fileDrag";

export function watchFileDragArea(element: HTMLElement, path: () => string | null | undefined, begin: (path: string) => void) {
  const gesture = createFileDragGesture(begin);
  const release = () => {
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("pointercancel", up, true);
  };
  const move = (e: PointerEvent) => {
    if (gesture.move({ x: e.clientX, y: e.clientY, pointerId: e.pointerId, buttons: e.buttons })) {
      e.preventDefault();
      release();
    } else if (!(e.buttons & 1)) release();
  };
  const up = () => {
    gesture.up();
    release();
  };
  const down = (e: PointerEvent) => {
    release();
    const pressed = path();
    gesture.down({ x: e.clientX, y: e.clientY, pointerId: e.pointerId, button: e.button }, pressed);
    if (e.button !== 0 || !pressed) return;
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
  };
  const click = (e: MouseEvent) => {
    if (!gesture.consumeClick()) return;
    e.preventDefault();
    e.stopPropagation();
  };
  element.addEventListener("pointerdown", down);
  element.addEventListener("click", click, true);
  return () => {
    release();
    element.removeEventListener("pointerdown", down);
    element.removeEventListener("click", click, true);
  };
}
