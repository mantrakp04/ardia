export type InkBox = { x: number; y: number; width: number; height: number };

export function inkShift(box: InkBox | null, canvas: number): readonly [number, number] {
  if (!box || (box.width <= 0 && box.height <= 0)) return [0, 0];
  return [canvas / 2 - (box.x + box.width / 2), canvas / 2 - (box.y + box.height / 2)];
}

export function measureInk(root: HTMLElement | null): InkBox | null {
  const svg = root?.querySelector("svg");
  if (!svg) return null;
  const { x, y, width, height } = svg.getBBox();
  return { x, y, width, height };
}
