export type SymbolLayer = { d: string; stroke?: number; fill?: boolean; evenOdd?: boolean; rotate?: number };

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

const DOCUMENT = "M13.5 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8.5z";
const DOCUMENT_FOLD = "M13.5 3v3.5a2 2 0 0 0 2 2H19";
const HAND =
  "M8 13V6.5a1.5 1.5 0 0 1 3 0V12" +
  "M11 11V5a1.5 1.5 0 0 1 3 0v6" +
  "M14 11V6.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5a6 6 0 0 1-4.6-2.2L3.2 15a1.5 1.5 0 0 1 2.3-1.9L8 15.5";

const SHIELD = "M12 2.8l7.5 2.9v5.6c0 4.8-3.1 8.6-7.5 10-4.4-1.4-7.5-5.2-7.5-10V5.7z";

function sparkle(cx: number, cy: number, r: number): string {
  const k = r * 0.28;
  return `M${cx} ${cy - r}Q${cx + k} ${cy - k} ${cx + r} ${cy}Q${cx + k} ${cy + k} ${cx} ${cy + r}Q${cx - k} ${cy + k} ${cx - r} ${cy}Q${cx - k} ${cy - k} ${cx} ${cy - r}Z`;
}

function gear(cx: number, cy: number, outer: number, inner: number, teeth: number): string {
  const points: number[] = [];
  for (let i = 0; i < teeth * 4; i++) {
    const angle = (i / (teeth * 4)) * Math.PI * 2;
    const r = i % 4 < 2 ? outer : inner;
    points.push(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
  }
  return `${polyline(...points)}Z`;
}

const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
  `M${cx - rx} ${cy}A${rx} ${ry} 0 1 1 ${cx + rx} ${cy}A${rx} ${ry} 0 1 1 ${cx - rx} ${cy}Z`;

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
  chevronUp: [{ d: polyline(5.5, 15.5, 12, 9, 18.5, 15.5), stroke: BOLD }],
  checkmark: [{ d: polyline(5, 12.5, 9.8, 17.3, 19, 6.6), stroke: BOLD }],
  arrowUturnBackward: [{ d: polyline(8.5, 13.5, 3.5, 8.5, 8.5, 3.5) + "M3.5 8.5H14a6 6 0 0 1 0 12H10.5", stroke: STROKE }],
  trash: [
    {
      d:
        line(4, 6.5, 20, 6.5) +
        "M9.5 6.5V4.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.7" +
        "M6 6.5l1 13a2 2 0 0 0 2 1.8h6a2 2 0 0 0 2-1.8l1-13" +
        line(10, 10.5, 10, 17.5) +
        line(14, 10.5, 14, 17.5),
      stroke: STROKE,
    },
  ],
  archivebox: [
    {
      d: roundRect(3, 3.5, 18, 5, 1.4) + "M4.5 8.5V18a2.5 2.5 0 0 0 2.5 2.5h10a2.5 2.5 0 0 0 2.5-2.5V8.5" + line(10, 12.5, 14, 12.5),
      stroke: STROKE,
    },
  ],
  squareOnSquare: [
    {
      d: roundRect(3.5, 8, 12.5, 12.5, 2.6) + "M8 8V6.5A2.5 2.5 0 0 1 10.5 4h7A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H16",
      stroke: STROKE,
    },
  ],
  ellipsis: [{ d: circle(5.5, 12, 1.75) + circle(12, 12, 1.75) + circle(18.5, 12, 1.75), fill: true }],
  eyes: [{ d: ellipse(7.6, 12, 3.6, 7) + ellipse(16.4, 12, 3.6, 7) + ellipse(6.9, 13, 1.65, 2.8) + ellipse(15.7, 13, 1.65, 2.8), fill: true, evenOdd: true }],
  chevronDown: [{ d: polyline(5.5, 8.5, 12, 15, 18.5, 8.5), stroke: BOLD }],
  minus: [{ d: line(5, 12, 19, 12), stroke: BOLD }],
  link: [{ d: roundRect(3.6, 9.2, 9.8, 5.6, 2.8) + roundRect(10.6, 9.2, 9.8, 5.6, 2.8), stroke: STROKE, rotate: -45 }],
  squareAndArrowUp: [
    {
      d: "M8.5 9.5H7.5A2.5 2.5 0 0 0 5 12v6.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V12a2.5 2.5 0 0 0-2.5-2.5h-1" + line(12, 2.8, 12, 14.5) + polyline(8.6, 6.2, 12, 2.8, 15.4, 6.2),
      stroke: STROKE,
    },
  ],
  docPlaintext: [{ d: DOCUMENT + DOCUMENT_FOLD + line(8.5, 10, 11.5, 10) + line(8.5, 13, 15.5, 13) + line(8.5, 16.5, 15.5, 16.5), stroke: STROKE }],
  textMagnifyingglass: [{ d: line(3, 6, 13, 6) + line(3, 10.5, 8, 10.5) + line(3, 15, 7, 15) + circle(15, 14, 4.2) + line(18.1, 17.1, 21, 20), stroke: STROKE }],
  translate: [{ d: "M3 5h10M8 3v2M5.5 5c.8 3.6 3.2 6.4 6.5 8M11 5c-.9 3.9-3.6 7.1-7.5 9M13 21l4-10 4 10M14.4 17.5h5.2", stroke: STROKE }],
  moon: [{ d: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z", stroke: STROKE }],
  moonFill: [{ d: "M20 14.5A8.5 8.5 0 1 1 9.5 4A8 8 0 0 0 20 14.5Z", fill: true }],
  textformatSize: [
    { d: polyline(2.5, 19, 8, 5, 13.5, 19) + line(4.6, 14, 11.4, 14), stroke: STROKE },
    { d: polyline(14.2, 19, 17.6, 10.5, 21, 19) + line(15.3, 16.2, 19.9, 16.2), stroke: 1.8 },
  ],
  desktop: [{ d: "M4 4.5h16a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 15V6A1.5 1.5 0 0 1 4 4.5zM12 16.5v3.5M8 20h8", stroke: STROKE }],
  handRaised: [{ d: HAND, stroke: STROKE }],
  handRaisedSlash: [{ d: HAND + "M3 3l18 18", stroke: STROKE }],
  plusSquareOnSquare: [{ d: "M8 3.5h10.5a2 2 0 0 1 2 2V16M5.5 7.5h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2zM10 11v6M7 14h6", stroke: STROKE }],
  arrowDownCircle: [{ d: "M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18zM12 7.5v8.5M8.5 12.5L12 16l3.5-3.5", stroke: STROKE }],
  exclamationmarkTriangle: [{ d: "M12 3.5L21.5 20h-19zM12 9.5v5M12 17.3h.01", stroke: STROKE }],
  eyeglasses: [{ d: circle(6.3, 13.5, 3.6) + circle(17.7, 13.5, 3.6) + "M9.9 13.2a2.6 2.6 0 0 1 4.2 0" + line(2.7, 13, 4.4, 7.5) + line(21.3, 13, 19.6, 7.5), stroke: STROKE }],
  info: [
    { d: circle(12, 6.3, 1.5), fill: true },
    { d: polyline(10, 10.5, 12.2, 10.5, 12.2, 18.7) + line(9.6, 18.7, 14.6, 18.7), stroke: 2 },
  ],
  paintpaletteFill: [
    {
      d:
        "M12 2.5C6.8 2.5 2.5 6.6 2.5 11.7c0 5 4.1 9.3 9.2 9.3 1.4 0 2.1-.8 2.1-1.8 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8h2.2c3 0 5.2-2.3 5.2-5.2C22 6.5 17.5 2.5 12 2.5z" +
        circle(7.3, 11.6, 1.5) +
        circle(9.6, 7.4, 1.5) +
        circle(14.4, 7.4, 1.5) +
        circle(17.1, 11.2, 1.5),
      fill: true,
      evenOdd: true,
    },
  ],
  keyboardFill: [
    {
      d:
        roundRect(1.8, 5.5, 20.4, 13, 2.6) +
        [8.2, 11.2].map((row) => [0, 1, 2, 3, 4, 5].map((key) => roundRect(3.4 + key * 3, row, 2.2, 1.9, 0.5)).join("")).join("") +
        roundRect(7, 14.4, 10, 1.9, 0.6),
      fill: true,
      evenOdd: true,
    },
  ],
  eraserFill: [
    {
      d: "M13.6 3.9a1.6 1.6 0 0 1 2.3 0l4.2 4.2a1.6 1.6 0 0 1 0 2.3L11 19.5H6.8l-3-3a1.6 1.6 0 0 1 0-2.3z" + polyline(7.76, 10.14, 14.06, 16.44, 13.14, 17.36, 6.84, 11.06) + "Z",
      fill: true,
      evenOdd: true,
    },
  ],
  sparkles: [{ d: sparkle(10, 13.5, 7) + sparkle(18, 5.5, 3.6) + sparkle(18.6, 18.2, 2.6), fill: true }],
  line3HorizontalDecrease: [{ d: line(4, 7, 20, 7) + line(7, 12, 17, 12) + line(10, 17, 14, 17), stroke: STROKE }],
  checkmarkShield: [{ d: SHIELD + polyline(8.6, 12.3, 11.1, 14.8, 15.6, 9.6), stroke: STROKE }],
  listBulletFill: [
    {
      d: roundRect(4.5, 2.5, 15, 19, 3.2) + [8, 12, 16].map((row) => circle(8.4, row, 1.15) + roundRect(10.6, row - 0.9, 5.4, 1.8, 0.9)).join(""),
      fill: true,
      evenOdd: true,
    },
  ],
  shieldLefthalf: [
    { d: SHIELD, stroke: STROKE },
    { d: "M12 2.8L4.5 5.7v5.6c0 4.8 3.1 8.6 7.5 10z", fill: true },
  ],
  gearshape: [{ d: gear(12, 12, 9.6, 7.6, 8) + circle(12, 12, 3.1), stroke: 1.8 }],
  docText: [{ d: DOCUMENT + DOCUMENT_FOLD + line(8.5, 13, 15.5, 13) + line(8.5, 16.5, 13.5, 16.5), stroke: STROKE }],
  code: [{ d: polyline(7.5, 7, 2.5, 12, 7.5, 17) + polyline(16.5, 7, 21.5, 12, 16.5, 17) + line(14, 4.5, 10, 19.5), stroke: STROKE }],
  handWave: [{ d: HAND + "M18.5 4.5c1.2.6 2 1.6 2.3 2.8M20 2.5c1.6.8 2.7 2.2 3 3.8", stroke: STROKE }],
  arrowRight: [{ d: line(4, 12, 19.5, 12) + polyline(13.5, 6, 19.5, 12, 13.5, 18), stroke: STROKE }],
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
  laptop: [{ d: roundRect(5, 5.5, 14, 9.5, 1.6) + line(2.5, 18.5, 21.5, 18.5), stroke: STROKE }],
  macDesktop: [{ d: roundRect(3.5, 4, 17, 12, 1.8) + line(10, 16, 9.2, 20) + line(14, 16, 14.8, 20) + line(7.8, 20, 16.2, 20), stroke: STROKE }],
  iphone: [{ d: roundRect(7, 2.8, 10, 18.4, 2.4) + line(10.6, 5.6, 13.4, 5.6), stroke: STROKE }],
  macAndPhone: [{ d: roundRect(2.5, 5, 13, 9, 1.4) + line(1.5, 17, 13, 17) + roundRect(16, 8, 6, 11.5, 1.5), stroke: STROKE }],
  star: [{ d: "M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z", stroke: STROKE }],
  starFill: [{ d: "M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z", fill: true }],
  paperplane: [{ d: "M3.5 11.2L20.5 3.5l-6.8 17-3-6.9z" + line(10.7, 13.6, 20.5, 3.5), stroke: STROKE }],
  folderFill: [{ d: "M3 7a2 2 0 0 1 2-2h4.2l2 2.2H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", fill: true }],
  lockFill: [{ d: roundRect(5, 10.5, 14, 10, 2.2), fill: true }, { d: "M8 10.5V7.8a4 4 0 0 1 8 0v2.7", stroke: STROKE }],
  wifiSlash: [{ d: "M2.8 9.2a13.5 13.5 0 0 1 18.4 0M5.8 12.4a9 9 0 0 1 12.4 0M8.9 15.6a4.6 4.6 0 0 1 6.2 0" + line(4, 4, 20, 20) + circle(12, 19, 0.6), stroke: STROKE }],
  squareStack: [{ d: roundRect(7, 7.5, 13, 13, 2.4) + "M4 15V6.5A2.5 2.5 0 0 1 6.5 4H15", stroke: STROKE }],
  pinFill: [{ d: "M9 3.5h6l-1 5.5 3 3.2V14H7v-1.8l3-3.2z", fill: true }, { d: line(12, 14, 12, 21), stroke: STROKE }],
  clockArrow: [{ d: circle(12, 12, 8.5) + polyline(12, 7.5, 12, 12, 15, 14), stroke: STROKE }],
  textCursor: [{ d: line(12, 4.5, 12, 19.5) + line(9, 4.5, 15, 4.5) + line(9, 19.5, 15, 19.5), stroke: STROKE }],
  docOnDoc: [{ d: roundRect(8, 8, 12, 13, 2) + "M5 16V5.5A2 2 0 0 1 7 3.5h9", stroke: STROKE }],
  checkmarkCircle: [{ d: circle(12, 12, 9.2) + polyline(7.8, 12.3, 10.7, 15.2, 16.3, 9.2), stroke: STROKE }],
  equalCircleFill: [{ d: circle(12, 12, 10) + roundRect(7.3, 8.8, 9.4, 2, 1) + roundRect(7.3, 13.2, 9.4, 2, 1), fill: true, evenOdd: true }],
  xmarkCircleFill: [{ d: circle(12, 12, 10) + cross(12, 12, 4.4, 1.05), fill: true, evenOdd: true }],
} satisfies Record<string, SymbolLayer[]>;

export type SymbolName = keyof typeof SYMBOLS;

export const isSymbolName = (name: string): name is SymbolName => name in SYMBOLS;
