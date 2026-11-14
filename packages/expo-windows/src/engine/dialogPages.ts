import type { DialogPagesNative } from "@ardia/shell";

const STALLED_AFTER_MS = 10000;

const counts = { asked: 0, stalled: 0 };
const waiting = new Map<string, ReturnType<typeof setTimeout>>();
let dialogOpen: () => boolean = () => false;

export function watchDialogsWith(open: () => boolean) {
  dialogOpen = open;
}

const anyDialogOpen = () => {
  try {
    return dialogOpen();
  } catch {
    return false;
  }
};

export function notePageSettled(key: string) {
  const timer = waiting.get(key);
  if (timer === undefined) return;
  clearTimeout(timer);
  waiting.delete(key);
}

export function notePageAsked(key: string) {
  if (!anyDialogOpen()) return;
  counts.asked += 1;
  notePageSettled(key);
  waiting.set(
    key,
    setTimeout(() => {
      waiting.delete(key);
      counts.stalled += 1;
    }, STALLED_AFTER_MS),
  );
}

export const windowsDialogPages: DialogPagesNative = {
  takeDialogPages() {
    const taken = { ...counts };
    counts.asked = 0;
    counts.stalled = 0;
    return taken;
  },
};
