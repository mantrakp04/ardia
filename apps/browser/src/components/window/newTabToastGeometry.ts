import type { PageEngine } from "../../state/engines/engines";
import type { PageLayout } from "../../state/tabs/pageState";

export function newTabToastRect(layout: PageLayout | null | undefined, width: number, height: number, nativePage: boolean, engine: PageEngine = "chromium") {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  if (!nativePage || engine === "webkit") return { x: 0, y: 0, width, height };
  if (!layout) return null;
  const values = [layout.x, layout.y, layout.width, layout.height, layout.containerWidth, layout.containerHeight];
  if (!values.every(Number.isFinite) || layout.width < 0 || layout.height < 0 || layout.containerWidth <= 0 || layout.containerHeight <= 0) return null;
  if (Math.abs(layout.containerWidth - width) > 0.5 || Math.abs(layout.containerHeight - height) > 0.5) return null;
  const x = Math.max(0, layout.x);
  const y = Math.max(0, layout.y);
  const right = Math.min(width, layout.x + layout.width);
  const bottom = Math.min(height, layout.y + layout.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}
