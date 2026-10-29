export const POPUP_MEASURE = `
const measure = () => {
  const d = document.documentElement, b = document.body;
  return { w: Math.ceil(Math.max(d.scrollWidth, b ? b.scrollWidth : 0)), h: Math.ceil(Math.max(d.scrollHeight, b ? b.scrollHeight : 0)) };
};
const last = window.__ardiaSize;
const now = measure();
if (!last || last.w !== now.w || last.h !== now.h) {
  window.__ardiaSize = now;
  post("result", JSON.stringify(now));
} else {
  const ro = new ResizeObserver(() => {
    const m = measure();
    if (m.w === window.__ardiaSize.w && m.h === window.__ardiaSize.h) return;
    ro.disconnect();
    window.__ardiaSize = m;
    post("result", JSON.stringify(m));
  });
  ro.observe(document.documentElement);
  if (document.body) ro.observe(document.body);
}`;

export type PopupSize = { width: number; height: number };

export class PopupSizeWaiters {
  private latest: PopupSize | null = null;
  private waiting: ((size: { w: number; h: number } | null) => void)[] = [];

  note(size: PopupSize) {
    this.latest = size;
    const waiting = this.waiting;
    this.waiting = [];
    for (const resolve of waiting) resolve({ w: size.width, h: size.height });
  }

  next(): Promise<{ w: number; h: number } | null> {
    if (this.latest) return Promise.resolve({ w: this.latest.width, h: this.latest.height });
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  close() {
    const waiting = this.waiting;
    this.waiting = [];
    for (const resolve of waiting) resolve(null);
  }
}

export function extensionViewEvaluate(script: unknown, sizes: PopupSizeWaiters): Promise<unknown> {
  return script === POPUP_MEASURE ? sizes.next() : Promise.resolve(null);
}
