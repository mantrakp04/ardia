export type WindowDragOptions = {
  titleBarDoubleClick: boolean;
  clickable: boolean;
  onRegionClick?: () => void;
  onRegionDoubleClick?: () => void;
};
export type WindowDragHost = { move(): Promise<unknown>; doubleClick(): Promise<unknown> };

export const WINDOW_DRAG_ROUTES = ["ArdiaShell.startWindowMove", "ArdiaShell.captionDoubleClick"] as const;

const DRAG_DISTANCE = 3;

export function watchWindowDrag(element: HTMLElement, options: () => WindowDragOptions, host: WindowDragHost | null, report: (error: unknown) => void) {
  let press: { x: number; y: number } | null = null;
  const end = () => {
    press = null;
    window.removeEventListener("mousemove", move, true);
    window.removeEventListener("mouseup", up, true);
  };
  const move = (event: MouseEvent) => {
    if (!press) return;
    if (!(event.buttons & 1)) return end();
    if (Math.hypot(event.screenX - press.x, event.screenY - press.y) < DRAG_DISTANCE) return;
    end();
    if (host) void host.move().catch(report);
  };
  const up = (event: MouseEvent) => {
    if (!press || event.button !== 0) return;
    end();
    const { clickable, onRegionClick } = options();
    if (clickable) onRegionClick?.();
  };
  const down = (event: MouseEvent) => {
    if (event.button !== 0 || event.ctrlKey || event.defaultPrevented) return;
    const { clickable, titleBarDoubleClick, onRegionDoubleClick } = options();
    const target = event.target as Node | null;
    if (!target || (target !== element && !(clickable && element.contains(target)))) return;
    event.preventDefault();
    end();
    if (!clickable && event.detail === 2) {
      if (titleBarDoubleClick) { if (host) void host.doubleClick().catch(report); }
      else onRegionDoubleClick?.();
      return;
    }
    press = { x: event.screenX, y: event.screenY };
    window.addEventListener("mousemove", move, true);
    window.addEventListener("mouseup", up, true);
  };
  element.addEventListener("mousedown", down);
  return () => {
    end();
    element.removeEventListener("mousedown", down);
  };
}
