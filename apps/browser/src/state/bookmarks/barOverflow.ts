type BarFrame = { x: number; width: number };

export function barFit(children: string[], frames: Record<string, BarFrame>, available: number, narrowestItem: number, overflowWidth: number) {
  const capacity = Math.max(0, Math.floor(available / narrowestItem)) + 1;
  const shown = children.length > capacity ? children.slice(0, capacity) : children;
  const pastEnd = (room: number) => (id: string) => {
    const f = frames[id];
    return !!f && f.x + f.width > room;
  };
  const overflowing = shown.length < children.length || shown.some(pastEnd(available));
  const cut = shown.findIndex(pastEnd(available - (overflowing ? overflowWidth : 0)));
  return { shown, visible: cut < 0 ? shown : shown.slice(0, cut) };
}
