type Ticker = (dt: number) => void;

const MAX_STEP = 1 / 30;
const tickers = new Set<Ticker>();
let frame = 0;
let last = 0;

function loop(now: number) {
  const dt = last ? Math.min(Math.max((now - last) / 1000, 0), MAX_STEP) : 0;
  last = now;
  for (const tick of [...tickers]) tick(dt);
  frame = tickers.size && !document.hidden ? requestAnimationFrame(loop) : 0;
  if (!frame) last = 0;
}

function wake() {
  if (!frame && tickers.size && !document.hidden) frame = requestAnimationFrame(loop);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
    } else {
      wake();
    }
  });
}

export function subscribeFrames(tick: Ticker): () => void {
  tickers.add(tick);
  wake();
  return () => {
    tickers.delete(tick);
  };
}

export function observeOnscreen(element: Element, onChange: (visible: boolean) => void): () => void {
  if (typeof IntersectionObserver === "undefined") {
    onChange(true);
    return () => {};
  }
  const observer = new IntersectionObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (entry) onChange(entry.isIntersecting);
  });
  observer.observe(element);
  return () => observer.disconnect();
}

export function observePixelSize(element: Element, onChange: (css: [number, number], pixels: [number, number]) => void): () => void {
  let last: ResizeObserverEntry | null = null;
  const report = (entry: ResizeObserverEntry) => {
    last = entry;
    const { width, height } = entry.contentRect;
    const device = entry.devicePixelContentBoxSize?.[0];
    const dpr = window.devicePixelRatio || 1;
    const scaled: [number, number] = [Math.round(width * dpr), Math.round(height * dpr)];
    const agrees = device && Math.abs(device.inlineSize - scaled[0]) <= 1 && Math.abs(device.blockSize - scaled[1]) <= 1;
    const pixels: [number, number] = agrees ? [device.inlineSize, device.blockSize] : scaled;
    onChange([width, height], pixels);
  };
  const observer = new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (entry) report(entry);
  });
  try {
    observer.observe(element, { box: "device-pixel-content-box" });
  } catch {
    observer.observe(element);
  }
  let query: MediaQueryList | null = null;
  const watchResolution = () => {
    query?.removeEventListener("change", onResolution);
    query = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`) ?? null;
    query?.addEventListener("change", onResolution);
  };
  const onResolution = () => {
    watchResolution();
    if (last) report(last);
  };
  watchResolution();
  return () => {
    observer.disconnect();
    query?.removeEventListener("change", onResolution);
  };
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
