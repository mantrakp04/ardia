export type SymbolLayer = { d: string; stroke?: number; fill?: boolean; evenOdd?: boolean };

const STROKE = 1.9;
const BOLD = 2.1;

const line = (x1: number, y1: number, x2: number, y2: number) => `M${x1} ${y1}L${x2} ${y2}`;

const polyline = (...points: number[]) =>
  points.reduce((path, value, index) => (index % 2 === 0 ? `${path}${index === 0 ? "M" : "L"}${value}` : `${path} ${value}`), "");

const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}A${r} ${r} 0 1 1 ${cx + r} ${cy}A${r} ${r} 0 1 1 ${cx - r} ${cy}Z`;

function roundRect(x: number, y: number, width: number, height: number, r: number): string {
  const c = Math.min(r, width / 2, height / 2);
  return (
    `M${x + c} ${y}L${x + width - c} ${y}A${c} ${c} 0 0 1 ${x + width} ${y + c}L${x + width} ${y + height - c}` +
    `A${c} ${c} 0 0 1 ${x + width - c} ${y + height}L${x + c} ${y + height}A${c} ${c} 0 0 1 ${x} ${y + height - c}` +
    `L${x} ${y + c}A${c} ${c} 0 0 1 ${x + c} ${y}Z`
  );
}

function cross(cx: number, cy: number, arm: number, half: number): string {
  const points: number[] = [];
  const corners = [
    [-half, -arm], [half, -arm], [half, -half], [arm, -half], [arm, half], [half, half],
    [half, arm], [-half, arm], [-half, half], [-arm, half], [-arm, -half], [-half, -half],
  ] as const;
  const turn = Math.PI / 4;
  for (const [x, y] of corners) {
    points.push(cx + x * Math.cos(turn) - y * Math.sin(turn), cy + x * Math.sin(turn) + y * Math.cos(turn));
  }
  return `${polyline(...points)}Z`;
}

export const SYMBOLS = {
  plus: [{ d: line(12, 5, 12, 19) + line(5, 12, 19, 12), stroke: BOLD }],
  xmark: [{ d: line(6.5, 6.5, 17.5, 17.5) + line(17.5, 6.5, 6.5, 17.5), stroke: BOLD }],
  chevronLeft: [{ d: polyline(15.5, 5, 8.5, 12, 15.5, 19), stroke: BOLD }],
  chevronRight: [{ d: polyline(8.5, 5, 15.5, 12, 8.5, 19), stroke: BOLD }],
  arrowClockwise: [{ d: "M19.5 12.5A7.5 7.5 0 1 1 15.6 5.9" + polyline(13.96, 2.25, 15.6, 5.9, 11.64, 6.45), stroke: STROKE }],
  arrowUpForward: [{ d: line(6.5, 17.5, 17, 7) + polyline(8.5, 7, 17, 7, 17, 15.5), stroke: STROKE }],
  magnifyingglass: [
    { d: circle(10.5, 10.5, 6.5), stroke: STROKE },
    { d: line(15.3, 15.3, 20, 20), stroke: 2.2 },
  ],
  globe: [
    {
      d:
        circle(12, 12, 9) +
        "M12 3c-2.6 2.5-3.8 5.5-3.8 9s1.2 6.5 3.8 9" +
        "M12 3c2.6 2.5 3.8 5.5 3.8 9s-1.2 6.5-3.8 9" +
        line(3, 12, 21, 12) +
        "M4.8 7.6c4.6 1.3 9.8 1.3 14.4 0" +
        "M4.8 16.4c4.6-1.3 9.8-1.3 14.4 0",
      stroke: 1.6,
    },
  ],
  equalCircleFill: [{ d: circle(12, 12, 10) + roundRect(7.3, 8.8, 9.4, 2, 1) + roundRect(7.3, 13.2, 9.4, 2, 1), fill: true, evenOdd: true }],
  xmarkCircleFill: [{ d: circle(12, 12, 10) + cross(12, 12, 4.4, 1.05), fill: true, evenOdd: true }],
} satisfies Record<string, SymbolLayer[]>;

export type SymbolName = keyof typeof SYMBOLS;
