const f = (n) => Math.round(n * 100) / 100;
const C = 16;
const P = (v, step, min, max) => ({ v, step, min, max });

function rr(cx, cy, w, h, r, extra = "") {
  const rx = Math.max(0, Math.min(r, w / 2, h / 2));
  return `<rect x="${f(cx - w / 2)}" y="${f(cy - h / 2)}" width="${f(w)}" height="${f(h)}" rx="${f(rx)}"${extra}/>`;
}
function rrPath(cx, cy, w, h, r) {
  const x0 = cx - w / 2, y0 = cy - h / 2, x1 = cx + w / 2, y1 = cy + h / 2;
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${f(x0 + r)} ${f(y0)}H${f(x1 - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x1)} ${f(y0 + r)}V${f(y1 - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x1 - r)} ${f(y1)}H${f(x0 + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x0)} ${f(y1 - r)}V${f(y0 + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x0 + r)} ${f(y0)}Z`;
}
const circlePath = (cx, cy, r) => `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
const line = (x1, y1, x2, y2, extra = "") => `<path d="M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}"${extra}/>`;
const dot = (cx, cy, r, extra = "") => `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="currentColor"${extra}/>`;
const FILL = ` fill="currentColor"`;
const SOLID = ` fill="currentColor" stroke="none"`;
const ghost = (o) => ` fill="currentColor" stroke="none" opacity="${f(o)}"`;

function halfRect(cx, cy, w, h, r, side) {
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
  if (side === "left") return `<path d="M${f(cx)} ${f(y0)}H${f(x0 + r)}A${f(r)} ${f(r)} 0 0 0 ${f(x0)} ${f(y0 + r)}V${f(y1 - r)}A${f(r)} ${f(r)} 0 0 0 ${f(x0 + r)} ${f(y1)}H${f(cx)}Z"${FILL}/>`;
  return `<path d="M${f(cx)} ${f(y0)}H${f(x1 - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x1)} ${f(y0 + r)}V${f(y1 - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x1 - r)} ${f(y1)}H${f(cx)}Z"${FILL}/>`;
}

const FRAME = { W: P(25.9, 0.4, 20, 30), H: P(19.9, 0.4, 15, 24), r: P(4.4, 0.3, 1.5, 8) };
const SQUARE = { S: P(19.8, 0.4, 15, 24), r: P(4.4, 0.3, 1.5, 8) };

export const ORIGINALS = {
  frame: { paint: "stroke", params: FRAME, make: (p) => rr(C, C, p.W, p.H, p.r) },
  square: { paint: "stroke", params: SQUARE, make: (p) => rr(C, C, p.S, p.S, p.r) },
  "square-dashed": {
    paint: "stroke",
    params: { ...SQUARE, dash: P(3.2, 0.2, 1.5, 6), gap: P(3, 0.2, 1, 6), off: P(1.5, 0.3, -6, 6) },
    make: (p) => rr(C, C, p.S, p.S, p.r, ` stroke-dasharray="${f(p.dash)} ${f(p.gap)}" stroke-dashoffset="${f(p.off)}" stroke-linecap="butt"`),
  },
  "square-x": {
    paint: "stroke",
    params: { ...SQUARE, x: P(4, 0.2, 2, 7) },
    make: (p) => rr(C, C, p.S, p.S, p.r) + line(C - p.x, C - p.x, C + p.x, C + p.x) + line(C + p.x, C - p.x, C - p.x, C + p.x),
  },
  macwindow: {
    paint: "stroke",
    params: { ...FRAME, dr: P(0.95, 0.1, 0.5, 1.6), dl: P(3.6, 0.2, 2, 6), dt: P(3.5, 0.2, 2, 6), dg: P(2.6, 0.15, 1.6, 4) },
    make: (p) => rr(C, C, p.W, p.H, p.r) + [0, 1, 2].map((i) => dot(C - p.W / 2 + p.dl + i * p.dg, C - p.H / 2 + p.dt, p.dr, ` stroke="none"`)).join(""),
  },
  "menubar.rectangle": {
    paint: "stroke",
    params: { ...FRAME, t: P(3.6, 0.2, 2, 6) },
    make: (p) => rr(C, C, p.W, p.H, p.r) + line(C - p.W / 2, C - p.H / 2 + p.t, C + p.W / 2, C - p.H / 2 + p.t),
  },
  "dock.rectangle": {
    paint: "stroke",
    params: { ...FRAME, bw: P(13, 0.4, 6, 20), bh: P(2.2, 0.15, 1, 4), bb: P(3.4, 0.2, 2, 6) },
    make: (p) => rr(C, C, p.W, p.H, p.r) + rr(C, C + p.H / 2 - p.bb, p.bw, p.bh, 0.8, SOLID),
  },
  "sidebar.left": {
    paint: "stroke",
    params: { ...FRAME, d: P(7.2, 0.3, 4, 12), ll: P(2.2, 0.2, 1, 4), lx: P(2.6, 0.2, 1.5, 5), ly: P(3.6, 0.2, 2, 6), lg: P(2.4, 0.15, 1.5, 4), lw: P(1.1, 0.1, 0.5, 2) },
    make: (p) => {
      const x0 = C - p.W / 2, y0 = C - p.H / 2;
      return rr(C, C, p.W, p.H, p.r) + line(x0 + p.d, y0, x0 + p.d, y0 + p.H) + [0, 1, 2].map((i) => line(x0 + p.lx, y0 + p.ly + i * p.lg, x0 + p.lx + p.ll, y0 + p.ly + i * p.lg, ` stroke-width="${f(p.lw)}"`)).join("");
    },
  },
  "rectangle.inset.filled": {
    paint: "stroke",
    params: { ...FRAME, i: P(3, 0.2, 1.5, 5), ir: P(1.6, 0.2, 0.3, 4) },
    make: (p) => rr(C, C, p.W, p.H, p.r) + rr(C, C, p.W - 2 * p.i, p.H - 2 * p.i, p.ir, SOLID),
  },
  "rectangle.half.filled": {
    paint: "stroke",
    params: FRAME,
    make: (p) => rr(C, C, p.W, p.H, p.r) + halfRect(C, C, p.W, p.H, p.r, "left"),
  },
  "rectangle.righthalf.inset.filled": {
    paint: "stroke",
    params: { ...FRAME, i: P(3, 0.2, 1.5, 5), ir: P(1.4, 0.2, 0.3, 4), g: P(0, 0.3, -4, 4) },
    make: (p) => {
      const iw = p.W / 2 - p.i - p.g, ih = p.H - 2 * p.i;
      return rr(C, C, p.W, p.H, p.r) + rr(C + p.W / 2 - p.i - iw / 2, C, iw, ih, p.ir, SOLID);
    },
  },
  "rectangle.bottomhalf.inset.filled": {
    paint: "stroke",
    params: { ...FRAME, i: P(3, 0.2, 1.5, 5), ir: P(1.4, 0.2, 0.3, 4), g: P(0, 0.3, -4, 4) },
    make: (p) => {
      const ih = p.H / 2 - p.i - p.g, iw = p.W - 2 * p.i;
      return rr(C, C, p.W, p.H, p.r) + rr(C, C + p.H / 2 - p.i - ih / 2, iw, ih, p.ir, SOLID);
    },
  },
  "rectangle.inset.arrow": {
    paint: "stroke",
    params: { ...FRAME, i: P(3, 0.2, 1.5, 5), ir: P(1.4, 0.2, 0.3, 4), g: P(0, 0.3, -4, 4), al: P(4.5, 0.3, 2, 8), ah: P(2.4, 0.2, 1, 4), ax: P(0, 0.3, -5, 5) },
    make: (p) => {
      const iw = p.W / 2 - p.i - p.g, ih = p.H - 2 * p.i, cxL = C - p.W / 4 + p.ax;
      return rr(C, C, p.W, p.H, p.r) + rr(C + p.W / 2 - p.i - iw / 2, C, iw, ih, p.ir, SOLID) +
        line(cxL - p.al / 2, C, cxL + p.al / 2, C) + `<path d="M${f(cxL + p.al / 2 - p.ah)} ${f(C - p.ah)}L${f(cxL + p.al / 2)} ${f(C)}L${f(cxL + p.al / 2 - p.ah)} ${f(C + p.ah)}" fill="none"/>`;
    },
  },
  "split.2x1": { paint: "stroke", params: FRAME, make: (p) => rr(C, C, p.W, p.H, p.r) + line(C, C - p.H / 2, C, C + p.H / 2) },
  "split.1x2": { paint: "stroke", params: FRAME, make: (p) => rr(C, C, p.W, p.H, p.r) + line(C - p.W / 2, C, C + p.W / 2, C) },
  "split.3x1": { paint: "stroke", params: FRAME, make: (p) => rr(C, C, p.W, p.H, p.r) + line(C - p.W / 6, C - p.H / 2, C - p.W / 6, C + p.H / 2) + line(C + p.W / 6, C - p.H / 2, C + p.W / 6, C + p.H / 2) },
  slash: { paint: "stroke", params: { L: P(13, 0.4, 6, 20) }, make: (p) => line(C - p.L / 2, C - p.L / 2, C + p.L / 2, C + p.L / 2) },
  "frame.screen": {
    paint: "stroke",
    params: { ...FRAME, o: P(0.3, 0.03, 0.1, 0.6) },
    make: (p) => rr(C, C, p.W, p.H, p.r, ` fill="currentColor" fill-opacity="${f(p.o)}"`),
  },
  display: {
    paint: "stroke",
    params: { W: P(26.5, 0.4, 20, 30), H: P(18.5, 0.4, 14, 22), r: P(2.6, 0.3, 1, 6), o: P(0.3, 0.03, 0.1, 0.6), nw: P(2.6, 0.2, 1, 5), nh: P(2.4, 0.2, 1, 4), bw: P(8, 0.4, 4, 14), dy: P(-1.6, 0.2, -4, 1) },
    make: (p) => {
      const top = C + p.dy - p.H / 2, bot = top + p.H;
      return rr(C, C + p.dy, p.W, p.H, p.r, ` fill="currentColor" fill-opacity="${f(p.o)}"`) + rr(C, bot + p.nh / 2, p.nw, p.nh, 0, SOLID) + line(C - p.bw / 2, bot + p.nh, C + p.bw / 2, bot + p.nh);
    },
  },
  tv: {
    paint: "stroke",
    params: { W: P(27.6, 0.4, 20, 31), H: P(19, 0.4, 14, 23), r: P(2.6, 0.3, 1, 6), o: P(0.3, 0.03, 0.1, 0.6), bw: P(10, 0.4, 4, 16), bg: P(2.6, 0.2, 1, 5), dy: P(-1.2, 0.2, -4, 1) },
    make: (p) => {
      const bot = C + p.dy + p.H / 2;
      return rr(C, C + p.dy, p.W, p.H, p.r, ` fill="currentColor" fill-opacity="${f(p.o)}"`) + line(C - p.bw / 2, bot + p.bg, C + p.bw / 2, bot + p.bg);
    },
  },
  laptop: {
    paint: "stroke",
    params: { W: P(23, 0.4, 16, 28), H: P(15, 0.4, 10, 20), r: P(2.2, 0.3, 0.8, 5), o: P(0.3, 0.03, 0.1, 0.6), bw: P(32, 0.4, 24, 34), dy: P(-1.6, 0.2, -4, 1) },
    make: (p) => {
      const bot = C + p.dy + p.H / 2;
      return rr(C, C + p.dy, p.W, p.H, p.r, ` fill="currentColor" fill-opacity="${f(p.o)}"`) + line(C - p.bw / 2, bot + 0.6, C + p.bw / 2, bot + 0.6);
    },
  },
  phone: {
    paint: "stroke",
    params: { W: P(9, 0.3, 6, 13), H: P(16, 0.4, 12, 22), r: P(2.2, 0.2, 1, 4), o: P(0.3, 0.03, 0.1, 0.6), sl: P(2.4, 0.2, 1, 4) },
    make: (p) => rr(C, C, p.W, p.H, p.r, ` fill="currentColor" fill-opacity="${f(p.o)}"`) + line(C - p.sl / 2, C + p.H / 2 - 2.2, C + p.sl / 2, C + p.H / 2 - 2.2, ` stroke-width="1"`),
  },
  mediabox: {
    paint: "fill",
    params: { W: P(14, 0.4, 8, 20), H: P(7, 0.3, 4, 11), r: P(1.8, 0.2, 0.5, 4), dr: P(1.1, 0.1, 0.5, 2), dx: P(3.6, 0.2, 1.5, 6) },
    make: (p) => `<path fill-rule="evenodd" d="${rrPath(C, C, p.W, p.H, p.r)}${circlePath(C + p.W / 2 - p.dx, C, p.dr)}"/>`,
  },
  "solid.frame": { paint: "fill", params: FRAME, make: (p) => rr(C, C, p.W, p.H, p.r) },
  "solid.square": { paint: "fill", params: SQUARE, make: (p) => rr(C, C, p.S, p.S, p.r) },
  "pip.arrow": {
    paint: "stroke",
    params: { L: P(5.2, 0.3, 2, 9), h: P(2.6, 0.2, 1, 5) },
    make: (p) => line(C - p.L / 2, C - p.L / 2, C + p.L / 2, C + p.L / 2) + `<path d="M${f(C + p.L / 2 - p.h)} ${f(C + p.L / 2)}H${f(C + p.L / 2)}V${f(C + p.L / 2 - p.h)}" fill="none"/>`,
  },
  "pip.arrow.out": {
    paint: "stroke",
    params: { L: P(5.2, 0.3, 2, 9), h: P(2.6, 0.2, 1, 5) },
    make: (p) => line(C - p.L / 2, C - p.L / 2, C + p.L / 2, C + p.L / 2) + `<path d="M${f(C - p.L / 2 + p.h)} ${f(C - p.L / 2)}H${f(C - p.L / 2)}V${f(C - p.L / 2 + p.h)}" fill="none"/>`,
  },
  dot: { paint: "fill", params: { R: P(3.6, 0.2, 1.5, 7) }, make: (p) => `<circle cx="${C}" cy="${C}" r="${f(p.R)}"/>` },
  "stack.lines": {
    paint: "stroke",
    params: { W1: P(20, 0.4, 10, 28), W2: P(16, 0.4, 8, 26), g: P(3, 0.2, 1.5, 5), r: P(3, 0.3, 0.5, 6), n: P(2, 0, 1, 2) },
    make: (p) => {
      const arc = (w, y) => `<path d="M${f(C - w / 2)} ${f(y + p.r)}A${f(p.r)} ${f(p.r)} 0 0 1 ${f(C - w / 2 + p.r)} ${f(y)}H${f(C + w / 2 - p.r)}A${f(p.r)} ${f(p.r)} 0 0 1 ${f(C + w / 2)} ${f(y + p.r)}" fill="none"/>`;
      return arc(p.W1, C) + (p.n > 1 ? arc(p.W2, C - p.g) : "");
    },
  },
  "chart.bar": {
    paint: "stroke",
    params: { bw: P(5.6, 0.2, 3, 8), gap: P(2.6, 0.2, 1, 5), h1: P(10, 0.4, 5, 20), h2: P(15, 0.4, 8, 24), h3: P(20, 0.4, 10, 26), r: P(1.6, 0.2, 0.5, 3), base: P(26, 0.3, 22, 29) },
    make: (p) => [p.h1, p.h2, p.h3].map((h, i) => rr(C + (i - 1) * (p.bw + p.gap), p.base - h / 2, p.bw, h, p.r)).join(""),
  },
  "list.bullet": {
    paint: "stroke",
    params: { W: P(16, 0.4, 10, 22), g: P(6, 0.2, 3, 9), dr: P(1.4, 0.1, 0.6, 2.4), dx: P(4.5, 0.2, 2, 8), x0: P(-1.5, 0.3, -6, 4) },
    make: (p) => [-1, 0, 1].map((i) => dot(C + p.x0 - p.W / 2 - p.dx, C + i * p.g, p.dr, ` stroke="none"`) + line(C + p.x0 - p.W / 2, C + i * p.g, C + p.x0 + p.W / 2, C + i * p.g)).join(""),
  },
  "text.alignleft": {
    paint: "stroke",
    params: { W: P(23, 0.4, 14, 28), g: P(5, 0.2, 3, 8), s1: P(16, 0.4, 8, 24), s2: P(19, 0.4, 8, 26) },
    make: (p) => [p.W, p.s2, p.W, p.s1].map((w, i) => line(C - p.W / 2, C + (i - 1.5) * p.g, C - p.W / 2 + w, C + (i - 1.5) * p.g)).join(""),
  },
  "text.lines.check": {
    paint: "stroke",
    params: { W: P(12, 0.4, 6, 18), g: P(5, 0.2, 3, 8), x0: P(5, 0.3, 0, 10), W2: P(22, 0.4, 14, 28) },
    make: (p) => line(C + p.x0 - p.W / 2, C - 1.5 * p.g, C + p.x0 + p.W / 2, C - 1.5 * p.g) + line(C + p.x0 - p.W / 2, C - 0.5 * p.g, C + p.x0 + p.W / 2, C - 0.5 * p.g) + line(C - p.W2 / 2, C + 0.5 * p.g, C + p.W2 / 2, C + 0.5 * p.g) + line(C - p.W2 / 2, C + 1.5 * p.g, C + p.W2 / 2, C + 1.5 * p.g),
  },
  doc: {
    paint: "stroke",
    params: { W: P(18, 0.4, 12, 24), H: P(23.5, 0.4, 18, 28), r: P(3, 0.2, 1, 5), c: P(7, 0.3, 3, 11), fr: P(1.6, 0.2, 0, 4) },
    make: (p) => {
      const x0 = C - p.W / 2, x1 = C + p.W / 2, y0 = C - p.H / 2, y1 = C + p.H / 2;
      return `<path d="M${f(x1 - p.c)} ${f(y0)}H${f(x0 + p.r)}A${f(p.r)} ${f(p.r)} 0 0 0 ${f(x0)} ${f(y0 + p.r)}V${f(y1 - p.r)}A${f(p.r)} ${f(p.r)} 0 0 0 ${f(x0 + p.r)} ${f(y1)}H${f(x1 - p.r)}A${f(p.r)} ${f(p.r)} 0 0 0 ${f(x1)} ${f(y1 - p.r)}V${f(y0 + p.c)}Z"/><path d="M${f(x1 - p.c)} ${f(y0)}V${f(y0 + p.c - p.fr)}Q${f(x1 - p.c)} ${f(y0 + p.c)} ${f(x1 - p.c + p.fr)} ${f(y0 + p.c)}H${f(x1)}" fill="none"/>`;
    },
  },
  "doc.text": {
    paint: "stroke",
    params: { W: P(18, 0.4, 12, 24), H: P(23.5, 0.4, 18, 28), r: P(3, 0.2, 1, 5), c: P(7, 0.3, 3, 11), fr: P(1.6, 0.2, 0, 4), lw: P(9, 0.3, 4, 14), lg: P(3.4, 0.2, 2, 5), ly: P(2.5, 0.3, -2, 6), lt: P(1.2, 0.1, 0.6, 2) },
    make: (p) => ORIGINALS.doc.make(p) + [0, 1, 2].map((i) => line(C - p.lw / 2, C + p.ly + (i - 1) * p.lg, C + p.lw / 2 - (i === 2 ? p.lw * 0.35 : 0), C + p.ly + (i - 1) * p.lg, ` stroke-width="${f(p.lt)}"`)).join(""),
  },
  battery: {
    paint: "stroke",
    params: { W: P(29, 0.4, 22, 32), H: P(15, 0.4, 10, 19), r: P(4.6, 0.3, 2, 8), nw: P(1.6, 0.15, 0.5, 3), nh: P(5, 0.3, 2, 8), i: P(2.6, 0.2, 1.2, 4), lv: P(0.25, 0.01, 0.1, 1), ir: P(2.2, 0.2, 0.5, 5), dx: P(-1.2, 0.2, -4, 2) },
    make: (p) => {
      const cx = C + p.dx, x0 = cx - p.W / 2, iw = (p.W - 2 * p.i) * p.lv;
      return rr(cx, C, p.W, p.H, p.r) + `<path d="M${f(cx + p.W / 2 + 1.6)} ${f(C - p.nh / 2)}a${f(p.nw)} ${f(p.nw)} 0 0 1 ${f(p.nw)} ${f(p.nw)}v${f(p.nh - 2 * p.nw)}a${f(p.nw)} ${f(p.nw)} 0 0 1 ${f(-p.nw)} ${f(p.nw)}Z"${SOLID}/>` + rr(x0 + p.i + iw / 2, C, iw, p.H - 2 * p.i, p.ir, SOLID);
    },
  },
  "battery.solid": {
    paint: "fill",
    params: { W: P(29, 0.4, 22, 32), H: P(15, 0.4, 10, 19), r: P(4.6, 0.3, 2, 8), nw: P(1.6, 0.15, 0.5, 3), nh: P(5, 0.3, 2, 8), dx: P(-1.2, 0.2, -4, 2) },
    make: (p) => {
      const cx = C + p.dx;
      return rr(cx, C, p.W, p.H, p.r) + `<path d="M${f(cx + p.W / 2 + 1.6)} ${f(C - p.nh / 2)}a${f(p.nw)} ${f(p.nw)} 0 0 1 ${f(p.nw)} ${f(p.nw)}v${f(p.nh - 2 * p.nw)}a${f(p.nw)} ${f(p.nw)} 0 0 1 ${f(-p.nw)} ${f(p.nw)}Z"/>`;
    },
  },
  "line.3.horizontal": {
    paint: "stroke",
    params: { W: P(23, 0.4, 14, 28), g: P(5.6, 0.2, 3, 9) },
    make: (p) => [-1, 0, 1].map((i) => line(C - p.W / 2, C + i * p.g, C + p.W / 2, C + i * p.g)).join(""),
  },
  "minus.bar": { paint: "stroke", params: { W: P(20, 0.4, 10, 28) }, make: (p) => line(C - p.W / 2, C, C + p.W / 2, C) },
  creditcard: {
    paint: "stroke",
    params: { W: P(25.9, 0.4, 20, 30), H: P(19, 0.4, 13, 22), r: P(3.4, 0.3, 1, 6), sy: P(4.4, 0.2, 2.5, 7), cw: P(4, 0.3, 2, 7), ch: P(3, 0.2, 1.5, 5), cx: P(3.4, 0.2, 2, 6), cy: P(3.4, 0.2, 2, 6) },
    make: (p) => rr(C, C, p.W, p.H, p.r) + line(C - p.W / 2, C - p.H / 2 + p.sy, C + p.W / 2, C - p.H / 2 + p.sy) + rr(C - p.W / 2 + p.cx + p.cw / 2, C + p.H / 2 - p.cy - p.ch / 2, p.cw, p.ch, 0.8, SOLID),
  },
  "creditcard.fill": {
    paint: "fill",
    params: { W: P(27.6, 0.4, 20, 31), H: P(20.6, 0.4, 13, 24), r: P(4, 0.3, 1, 7), sy: P(4.4, 0.2, 2.5, 7), sh: P(2.6, 0.2, 1, 4), cw: P(4, 0.3, 2, 7), ch: P(3, 0.2, 1.5, 5), cx: P(3.4, 0.2, 2, 6), cy: P(3.4, 0.2, 2, 6) },
    make: (p) => `<path fill-rule="evenodd" d="${rrPath(C, C, p.W, p.H, p.r)}${rrPath(C, C - p.H / 2 + p.sy, p.W + 2, p.sh, 0)}${rrPath(C - p.W / 2 + p.cx + p.cw / 2, C + p.H / 2 - p.cy - p.ch / 2, p.cw, p.ch, 0.8)}"/>`,
  },
  folder: {
    paint: "stroke",
    params: { W: P(26, 0.4, 20, 30), H: P(20.5, 0.4, 15, 24), r: P(3.4, 0.3, 1.5, 6), tw: P(9.5, 0.3, 5, 14), th: P(2.6, 0.2, 1, 5), ts: P(2.6, 0.2, 0.5, 5), tr: P(2, 0.2, 0.5, 4), ly: P(5.2, 0.2, 3, 8), li: P(2.6, 0.2, 0.5, 5) },
    make: (p) => {
      const x0 = C - p.W / 2, x1 = C + p.W / 2, y0 = C - p.H / 2, y1 = C + p.H / 2, yb = y0 + p.th, r = p.r, tr = p.tr;
      const outline = `<path d="M${f(x0)} ${f(y0 + tr)}A${f(tr)} ${f(tr)} 0 0 1 ${f(x0 + tr)} ${f(y0)}H${f(x0 + p.tw - p.ts / 2)}Q${f(x0 + p.tw)} ${f(y0)} ${f(x0 + p.tw + p.ts / 2)} ${f(yb - p.th / 2)}Q${f(x0 + p.tw + p.ts)} ${f(yb)} ${f(x0 + p.tw + p.ts * 1.5)} ${f(yb)}H${f(x1 - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x1)} ${f(yb + r)}V${f(y1 - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x1 - r)} ${f(y1)}H${f(x0 + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x0)} ${f(y1 - r)}Z"/>`;
      return outline + line(x0 + p.li, y0 + p.ly, x1 - p.li, y0 + p.ly);
    },
  },
  calendar: {
    paint: "stroke",
    params: { W: P(23, 0.4, 18, 28), H: P(21, 0.4, 16, 26), r: P(3.6, 0.3, 1.5, 6), hh: P(4.2, 0.2, 2, 7), d: P(1.5, 0.1, 0.8, 2.4), gx: P(4, 0.15, 2.5, 5.5), gy: P(3.8, 0.15, 2.5, 5.5), oy: P(2.8, 0.2, 0, 5) },
    make: (p) => {
      const x0 = C - p.W / 2, y0 = C - p.H / 2, r = p.r;
      const head = `<path d="M${f(x0)} ${f(y0 + p.hh)}V${f(y0 + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x0 + r)} ${f(y0)}H${f(x0 + p.W - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x0 + p.W)} ${f(y0 + r)}V${f(y0 + p.hh)}Z"${SOLID}/>`;
      const rows = [[1, 2, 3], [0, 1, 2, 3], [0, 1, 2]];
      const dots = rows.flatMap((cols, ri) => cols.map((ci) => `<rect x="${f(C + (ci - 1.5) * p.gx - p.d / 2)}" y="${f(C + p.oy + (ri - 1) * p.gy - p.d / 2)}" width="${f(p.d)}" height="${f(p.d)}" rx="${f(p.d * 0.3)}"${SOLID}/>`)).join("");
      return rr(C, C, p.W, p.H, r) + head + dots;
    },
  },
  speaker: {
    paint: "stroke",
    params: { bw: P(4.2, 0.2, 2, 7), bh: P(7.6, 0.2, 4, 11), ch: P(18, 0.4, 12, 24), cw: P(6.4, 0.3, 3, 10), x: P(-8, 0.3, -14, -2) },
    make: (p) => {
      const xb = C + p.x, xc = xb + p.bw, xe = xc + p.cw;
      return `<path d="M${f(xb)} ${f(C - p.bh / 2)}H${f(xc)}L${f(xe)} ${f(C - p.ch / 2)}V${f(C + p.ch / 2)}L${f(xc)} ${f(C + p.bh / 2)}H${f(xb)}Z"/>`;
    },
  },
  "speaker.solid": {
    paint: "fill",
    params: { bw: P(4.2, 0.2, 2, 7), bh: P(7.6, 0.2, 4, 11), ch: P(18, 0.4, 12, 24), cw: P(6.4, 0.3, 3, 10), x: P(-8, 0.3, -14, -2) },
    make: (p) => {
      const xb = C + p.x, xc = xb + p.bw, xe = xc + p.cw;
      return `<path stroke-linejoin="round" d="M${f(xb)} ${f(C - p.bh / 2)}H${f(xc)}L${f(xe)} ${f(C - p.ch / 2)}V${f(C + p.ch / 2)}L${f(xc)} ${f(C + p.bh / 2)}H${f(xb)}Z"/>`;
    },
  },
  trash: {
    paint: "stroke",
    params: { lw: P(24, 0.4, 16, 30), ly: P(-7.6, 0.3, -12, -4), hw: P(8, 0.3, 4, 12), hh: P(3.2, 0.2, 1.5, 5), hr: P(1.6, 0.2, 0.5, 3), tw: P(18, 0.4, 12, 24), bw: P(15, 0.4, 10, 22), bh: P(18, 0.4, 12, 24), br: P(2.8, 0.2, 0.5, 5), vl: P(11, 0.4, 5, 16), vg: P(3.6, 0.2, 2, 5) },
    make: (p) => {
      const yl = C + p.ly, yb = yl + p.bh, xt = p.tw / 2, xb = p.bw / 2, br = p.br;
      const body = `<path d="M${f(C - xt)} ${f(yl)}L${f(C - xb)} ${f(yb - br)}Q${f(C - xb)} ${f(yb)} ${f(C - xb + br)} ${f(yb)}H${f(C + xb - br)}Q${f(C + xb)} ${f(yb)} ${f(C + xb)} ${f(yb - br)}L${f(C + xt)} ${f(yl)}" fill="none"/>`;
      const handle = `<path d="M${f(C - p.hw / 2)} ${f(yl)}V${f(yl - p.hh + p.hr)}A${f(p.hr)} ${f(p.hr)} 0 0 1 ${f(C - p.hw / 2 + p.hr)} ${f(yl - p.hh)}H${f(C + p.hw / 2 - p.hr)}A${f(p.hr)} ${f(p.hr)} 0 0 1 ${f(C + p.hw / 2)} ${f(yl - p.hh + p.hr)}V${f(yl)}" fill="none"/>`;
      const bars = [-1, 0, 1].map((i) => line(C + i * p.vg, yl + (p.bh - p.vl) / 2 + 0.5, C + i * p.vg, yl + (p.bh + p.vl) / 2 + 0.5)).join("");
      return line(C - p.lw / 2, yl, C + p.lw / 2, yl) + handle + body + bars;
    },
  },
  globe: {
    paint: "stroke",
    params: { R: P(11, 0.3, 8, 13), mw: P(5.2, 0.2, 2, 8), l: P(5.4, 0.2, 3, 8) },
    make: (p) => {
      const lat = (y) => { const h = Math.sqrt(Math.max(0, p.R * p.R - y * y)); return line(C - h, C + y, C + h, C + y); };
      return `<circle cx="${C}" cy="${C}" r="${f(p.R)}"/><ellipse cx="${C}" cy="${C}" rx="${f(p.mw)}" ry="${f(p.R)}"/>` + line(C, C - p.R, C, C + p.R) + lat(0) + lat(-p.l) + lat(p.l);
    },
  },
  "arrow.circle": {
    paint: "stroke",
    params: { R: P(9.3, 0.3, 6, 13), a0: P(0, 3, -40, 40), sweep: P(270, 4, 220, 320), L: P(3.6, 0.3, 0, 8), h: P(4.6, 0.25, 2, 8), hk: P(1, 0.05, 0.5, 1.4) },
    make: (p) => {
      const t0 = (p.a0 * Math.PI) / 180, t1 = ((p.a0 - p.sweep) * Math.PI) / 180;
      const sx = C + p.R * Math.cos(t0), sy = C - p.R * Math.sin(t0), ex = C + p.R * Math.cos(t1), ey = C - p.R * Math.sin(t1);
      const ux = Math.sin(t1), uy = Math.cos(t1);
      const tx = ex + ux * p.L, ty = ey + uy * p.L;
      const dir = (Math.atan2(uy, ux) * 180) / Math.PI;
      return `<path d="M${f(sx)} ${f(sy)}A${f(p.R)} ${f(p.R)} 0 ${p.sweep > 180 ? 1 : 0} 1 ${f(ex)} ${f(ey)}L${f(tx)} ${f(ty)}" fill="none"/><path d="M${f(tx - p.h * p.hk)} ${f(ty - p.h)}L${f(tx)} ${f(ty)}L${f(tx - p.h * p.hk)} ${f(ty + p.h)}" fill="none" transform="rotate(${f(dir)} ${f(tx)} ${f(ty)})"/>`;
    },
  },
  "two.circlepath": {
    paint: "stroke",
    params: { R: P(9.5, 0.3, 6, 13), a: P(25, 2, 5, 50), h: P(3, 0.2, 1.5, 5) },
    make: (p) => {
      const pt = (deg) => [C + p.R * Math.cos((deg * Math.PI) / 180), C - p.R * Math.sin((deg * Math.PI) / 180)];
      const [ax, ay] = pt(180 - p.a), [bx, by] = pt(p.a), [cx2, cy2] = pt(-p.a), [dx2, dy2] = pt(180 + p.a);
      const head = (x, y, dir) => `<path d="M${f(x - p.h)} ${f(y)}L${f(x + p.h)} ${f(y)}L${f(x)} ${f(y + dir * p.h)}Z" fill="currentColor"/>`;
      return `<path d="M${f(ax)} ${f(ay)}A${f(p.R)} ${f(p.R)} 0 0 1 ${f(bx)} ${f(by)}" fill="none"/><path d="M${f(cx2)} ${f(cy2)}A${f(p.R)} ${f(p.R)} 0 0 1 ${f(dx2)} ${f(dy2)}" fill="none"/>` + head(bx, by, 1) + head(dx2, dy2, -1);
    },
  },
  "radiowaves": {
    paint: "stroke",
    params: { d: P(1.8, 0.1, 1, 3), r1: P(4.6, 0.2, 2.5, 7), dr: P(4, 0.2, 2, 6), a: P(48, 2, 30, 70), n: P(3, 0, 1, 3) },
    make: (p) => {
      let out = `<circle cx="${C}" cy="${C}" r="${f(p.d)}" fill="currentColor" stroke="none"/>`;
      for (let i = 0; i < Math.round(p.n); i++) {
        const r = p.r1 + i * p.dr, t = ((p.a + i * 3) * Math.PI) / 180, x = r * Math.cos(t), y = r * Math.sin(t);
        out += `<path d="M${f(C + x)} ${f(C - y)}A${f(r)} ${f(r)} 0 0 1 ${f(C + x)} ${f(C + y)}" fill="none"/><path d="M${f(C - x)} ${f(C - y)}A${f(r)} ${f(r)} 0 0 0 ${f(C - x)} ${f(C + y)}" fill="none"/>`;
      }
      return out;
    },
  },
  "person.crop.circle": {
    paint: "stroke",
    params: { R: P(11, 0.3, 8, 13), hr: P(4, 0.2, 2, 6), hy: P(-2.6, 0.2, -6, 1), sr: P(8, 0.3, 4, 12), sy: P(6.5, 0.3, 2, 11), sh: P(0.75, 0.03, 0.4, 1.1) },
    make: (p) => {
      const ri = p.R - 0.2;
      const pts = [];
      for (let i = 0; i <= 24; i++) {
        const t = Math.PI + (i / 24) * Math.PI;
        const x = C + p.sr * Math.cos(t), y = C + p.sy + p.sr * p.sh * Math.sin(t);
        if ((x - C) ** 2 + (y - C) ** 2 <= ri * ri) pts.push([x, y]);
      }
      if (pts.length < 2) return `<circle cx="${C}" cy="${C}" r="${f(p.R)}"/>`;
      const [a, b] = [pts[0], pts[pts.length - 1]];
      const body = `<path d="M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join("L")}A${f(ri)} ${f(ri)} 0 0 1 ${f(a[0])} ${f(a[1])}Z" fill="currentColor" stroke="none"/>`;
      return `<circle cx="${C}" cy="${C}" r="${f(p.R)}"/><circle cx="${C}" cy="${f(C + p.hy)}" r="${f(p.hr)}" fill="currentColor" stroke="none"/>` + body;
    },
  },
  "box.arrow": {
    paint: "stroke",
    params: { W: P(15, 0.4, 10, 22), H: P(13, 0.4, 8, 18), r: P(3, 0.2, 1, 5), g: P(4.6, 0.2, 2, 8), by: P(4, 0.3, 0, 8), al: P(15, 0.4, 8, 22), ay: P(-3, 0.3, -9, 3), h: P(3.6, 0.2, 2, 6), dir: P(-1, 0, -1, 1) },
    make: (p) => {
      const x0 = C - p.W / 2, x1 = C + p.W / 2, y0 = C + p.by - p.H / 2, y1 = C + p.by + p.H / 2, r = p.r;
      const box = `<path d="M${f(x0 + p.W / 2 - p.g)} ${f(y0)}H${f(x0 + r)}A${f(r)} ${f(r)} 0 0 0 ${f(x0)} ${f(y0 + r)}V${f(y1 - r)}A${f(r)} ${f(r)} 0 0 0 ${f(x0 + r)} ${f(y1)}H${f(x1 - r)}A${f(r)} ${f(r)} 0 0 0 ${f(x1)} ${f(y1 - r)}V${f(y0 + r)}A${f(r)} ${f(r)} 0 0 0 ${f(x1 - r)} ${f(y0)}H${f(x1 - p.W / 2 + p.g)}" fill="none"/>`;
      const ya = C + p.ay - p.al / 2, yb = C + p.ay + p.al / 2;
      const tipY = p.dir < 0 ? ya : yb, s = p.dir < 0 ? 1 : -1;
      return box + line(C, ya, C, yb) + `<path d="M${f(C - p.h)} ${f(tipY + s * p.h)}L${C} ${f(tipY)}L${f(C + p.h)} ${f(tipY + s * p.h)}" fill="none"/>`;
    },
  },
  sliders: {
    paint: "stroke",
    params: { W: P(23, 0.4, 16, 28), g: P(7, 0.2, 4, 10), kw: P(5.4, 0.3, 3, 8), kh: P(3.6, 0.2, 2, 5), k1: P(4, 0.4, -8, 8), k2: P(-4.5, 0.4, -8, 8), k3: P(1.5, 0.4, -8, 8) },
    make: (p) => [p.k1, p.k2, p.k3].map((k, i) => {
      const y = C + (i - 1) * p.g;
      return line(C - p.W / 2, y, C + k - p.kw / 2 - 1.2, y) + line(C + k + p.kw / 2 + 1.2, y, C + p.W / 2, y) + rr(C + k, y, p.kw, p.kh, p.kh / 2);
    }).join(""),
  },
  hifispeaker: {
    paint: "stroke",
    params: { W: P(15, 0.4, 10, 20), H: P(22, 0.4, 16, 27), r: P(3, 0.2, 1, 5), r1: P(1.4, 0.1, 0.6, 3), y1: P(-5, 0.3, -9, -2), r2: P(3.8, 0.2, 2, 6), y2: P(3.4, 0.3, 0, 7) },
    make: (p) => rr(C, C, p.W, p.H, p.r) + `<circle cx="${C}" cy="${f(C + p.y1)}" r="${f(p.r1)}"/><circle cx="${C}" cy="${f(C + p.y2)}" r="${f(p.r2)}"/>`,
  },
  glasses: {
    paint: "stroke",
    params: { R: P(4.6, 0.2, 3, 7), sep: P(13, 0.3, 9, 18), by: P(-0.6, 0.2, -3, 2), arm: P(2.4, 0.2, 0.5, 5), ay: P(-1.6, 0.2, -4, 1) },
    make: (p) => {
      const lx = C - p.sep / 2, rx = C + p.sep / 2;
      return `<circle cx="${f(lx)}" cy="${C}" r="${f(p.R)}"/><circle cx="${f(rx)}" cy="${C}" r="${f(p.R)}"/><path d="M${f(lx + p.R)} ${f(C + p.by)}Q${C} ${f(C + p.by - 2)} ${f(rx - p.R)} ${f(C + p.by)}" fill="none"/>` + line(lx - p.R, C + p.ay, lx - p.R - p.arm, C + p.ay - 0.6) + line(rx + p.R, C + p.ay, rx + p.R + p.arm, C + p.ay - 0.6);
    },
  },
  capsule: {
    paint: "stroke",
    params: { L: P(13, 0.4, 8, 18), Wc: P(7, 0.3, 4, 10) },
    make: (p) => rr(C, C, p.L, p.Wc, p.Wc / 2),
  },
  "speaker.waves": {
    paint: "stroke",
    params: { bw: P(4, 0.2, 2, 7), bh: P(7.6, 0.2, 4, 11), ch: P(18, 0.4, 12, 24), cw: P(6, 0.3, 3, 10), x: P(-11, 0.3, -16, -4), g: P(3.4, 0.2, 1.5, 6), r1: P(3.4, 0.2, 2, 6), dr: P(4.2, 0.2, 2.5, 7), a: P(42, 1.5, 25, 65), n: P(2, 0, 1, 3), solid: P(0, 0, 0, 1) },
    make: (p) => {
      const xb = C + p.x, xc = xb + p.bw, xe = xc + p.cw;
      const fill = p.solid ? ` fill="currentColor"` : "";
      let out = `<path${fill} d="M${f(xb)} ${f(C - p.bh / 2)}H${f(xc)}L${f(xe)} ${f(C - p.ch / 2)}V${f(C + p.ch / 2)}L${f(xc)} ${f(C + p.bh / 2)}H${f(xb)}Z"/>`;
      const cx = xe + p.g - p.r1;
      for (let i = 0; i < Math.round(p.n); i++) {
        const r = p.r1 + i * p.dr, t = ((p.a + i * 3) * Math.PI) / 180;
        out += `<path d="M${f(cx + r * Math.cos(t))} ${f(C - r * Math.sin(t))}A${f(r)} ${f(r)} 0 0 1 ${f(cx + r * Math.cos(t))} ${f(C + r * Math.sin(t))}" fill="none"/>`;
      }
      return out;
    },
  },
  "clock.hands": {
    paint: "stroke",
    params: { m: P(5.5, 0.25, 2, 9), hx: P(4, 0.25, 1, 8), hy: P(3, 0.25, 0, 7) },
    make: (p) => `<path d="M${C} ${f(C - p.m)}V${C}L${f(C + p.hx)} ${f(C + p.hy)}" fill="none"/>`,
  },
  quotes: {
    paint: "fill",
    params: { r: P(2.6, 0.15, 1.2, 4.5), g: P(7, 0.25, 4, 10), t: P(3.6, 0.2, 1, 6), tw: P(1.6, 0.15, 0.5, 3) },
    make: (p) => [-1, 1].map((side) => {
      const cx = C + (side * p.g) / 2, cy = C - p.t / 3;
      return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(p.r)}"/><path d="M${f(cx + p.r)} ${f(cy)}Q${f(cx + p.r)} ${f(cy + p.t + p.r * 0.6)} ${f(cx - p.r * 0.4)} ${f(cy + p.r + p.t)}L${f(cx - p.r * 0.4 - p.tw * 0.3)} ${f(cy + p.r + p.t - p.tw)}Q${f(cx + p.r * 0.2)} ${f(cy + p.t)} ${f(cx)} ${f(cy + p.r)}Z"/>`;
    }).join(""),
  },
  wen: {
    paint: "stroke",
    params: { w: P(14, 0.4, 8, 20), h: P(16, 0.4, 10, 22), t: P(2.4, 0.2, 1, 4), bar: P(-3, 0.3, -7, 0), cross: P(7, 0.3, 3, 10) },
    make: (p) => {
      const top = C - p.h / 2, barY = C + p.bar, bottom = C + p.h / 2, half = p.w / 2, x = p.cross / 2;
      return line(C, top, C, top + p.t) + line(C - half, barY, C + half, barY) + `<path d="M${f(C - x)} ${f(barY + 1.5)}Q${f(C)} ${f(bottom - 2)} ${f(C + half)} ${f(bottom)}" fill="none"/><path d="M${f(C + x)} ${f(barY + 1.5)}Q${f(C)} ${f(bottom - 2)} ${f(C - half)} ${f(bottom)}" fill="none"/>`;
    },
  },
};
