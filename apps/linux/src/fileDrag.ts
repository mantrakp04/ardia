export const FILE_DRAG_THRESHOLD = 4;

type Pointer = { x: number; y: number; pointerId: number };

export function createFileDragGesture(begin: (path: string) => void) {
  let start: (Pointer & { path: string }) | null = null;
  let began = false;
  return {
    down(e: Pointer & { button: number }, path: string | null | undefined) {
      began = false;
      start = e.button === 0 && path ? { x: e.x, y: e.y, pointerId: e.pointerId, path } : null;
    },
    move(e: Pointer & { buttons: number }) {
      if (!start || began || e.pointerId !== start.pointerId) return false;
      if (!(e.buttons & 1)) {
        start = null;
        return false;
      }
      if (Math.hypot(e.x - start.x, e.y - start.y) < FILE_DRAG_THRESHOLD) return false;
      began = true;
      begin(start.path);
      start = null;
      return true;
    },
    up() {
      start = null;
    },
    consumeClick() {
      const suppress = began;
      began = false;
      return suppress;
    },
  };
}
