import { symbolLayers, symbolNudge, SYMBOL_NAMES } from "../../../demo/src/shims/web/symbols/data";
import { fitFor, type SymbolLayer, type SymbolWeight } from "../../../demo/src/shims/web/symbols/render";

export type { SymbolWeight };

export type VectorElement = {
  d: string;
  matrix: number[];
  evenOdd: boolean;
  fill: number;
  stroke: number;
  width: number;
  cap: string;
  join: string;
  dashes: number[];
  dashOffset: number;
  maskFill: boolean;
  maskStroke: boolean;
  maskWidth: number;
};

export type VectorLayer = { draw: boolean; cut: boolean; elements: VectorElement[] };

export type VectorIcon = { key: string; layers: VectorLayer[] };

type Matrix = readonly [number, number, number, number, number, number];

type BodyElement = { d: string; transform: Matrix; attributes: Record<string, string> };

export const NATIVE_DEFAULT_POINT_SIZE = 14;

export const vectorSymbolNames = SYMBOL_NAMES;

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const precise = (n: number) => Number(n.toPrecision(5));

function compose(outer: Matrix, inner: Matrix): Matrix {
  const [a, b, c, d, e, f] = outer;
  const [a2, b2, c2, d2, e2, f2] = inner;
  return [a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f];
}

const translation = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];

const scaling = (x: number, y: number): Matrix => [x, 0, 0, y, 0, 0];

function rotation(degrees: number): Matrix {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [cos, sin, -sin, cos, 0, 0];
}

const numbersIn = (text: string | undefined) =>
  (text ?? "")
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite);

function parseTransform(text: string | undefined): Matrix {
  if (!text) return IDENTITY;
  let matrix = IDENTITY;
  for (const [, kind, args] of text.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const n = numbersIn(args);
    let step: Matrix = IDENTITY;
    if (kind === "matrix" && n.length === 6) step = [n[0]!, n[1]!, n[2]!, n[3]!, n[4]!, n[5]!];
    else if (kind === "translate") step = translation(n[0] ?? 0, n[1] ?? 0);
    else if (kind === "scale") step = scaling(n[0] ?? 1, n[1] ?? n[0] ?? 1);
    else if (kind === "rotate") {
      const [angle = 0, cx = 0, cy = 0] = n;
      step = compose(compose(translation(cx, cy), rotation(angle)), translation(-cx, -cy));
    } else if (kind === "skewX") step = [1, 0, Math.tan(((n[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    else if (kind === "skewY") step = [1, Math.tan(((n[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    matrix = compose(matrix, step);
  }
  return matrix;
}

const number = (text: string | undefined, fallback: number) => {
  const value = text === undefined ? NaN : parseFloat(text);
  return Number.isFinite(value) ? value : fallback;
};

function ellipsePath(cx: number, cy: number, rx: number, ry: number) {
  return `M${cx + rx} ${cy}A${rx} ${ry} 0 0 1 ${cx} ${cy + ry}A${rx} ${ry} 0 0 1 ${cx - rx} ${cy}A${rx} ${ry} 0 0 1 ${cx} ${cy - ry}A${rx} ${ry} 0 0 1 ${cx + rx} ${cy}Z`;
}

function rectPath(attributes: Record<string, string>) {
  const x = number(attributes.x, 0);
  const y = number(attributes.y, 0);
  const width = number(attributes.width, 0);
  const height = number(attributes.height, 0);
  if (!(width > 0) || !(height > 0)) return "";
  const rxGiven = attributes.rx !== undefined ? Math.max(0, number(attributes.rx, 0)) : undefined;
  const ryGiven = attributes.ry !== undefined ? Math.max(0, number(attributes.ry, 0)) : undefined;
  const rx = Math.min(rxGiven ?? ryGiven ?? 0, width / 2);
  const ry = Math.min(ryGiven ?? rxGiven ?? 0, height / 2);
  if (rx <= 0 || ry <= 0) return `M${x} ${y}H${x + width}V${y + height}H${x}Z`;
  return (
    `M${x + rx} ${y}H${x + width - rx}A${rx} ${ry} 0 0 1 ${x + width} ${y + ry}V${y + height - ry}` +
    `A${rx} ${ry} 0 0 1 ${x + width - rx} ${y + height}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + height - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
  );
}

function pointsPath(text: string | undefined, closed: boolean) {
  const n = numbersIn(text);
  if (n.length < 4) return "";
  let d = `M${n[0]} ${n[1]}`;
  for (let i = 2; i + 1 < n.length; i += 2) d += `L${n[i]} ${n[i + 1]}`;
  return closed ? `${d}Z` : d;
}

function pathData(tag: string, attributes: Record<string, string>) {
  switch (tag) {
    case "path":
      return attributes.d ?? "";
    case "circle": {
      const r = number(attributes.r, 0);
      return r > 0 ? ellipsePath(number(attributes.cx, 0), number(attributes.cy, 0), r, r) : "";
    }
    case "ellipse": {
      const rx = number(attributes.rx, 0);
      const ry = number(attributes.ry, 0);
      return rx > 0 && ry > 0 ? ellipsePath(number(attributes.cx, 0), number(attributes.cy, 0), rx, ry) : "";
    }
    case "rect":
      return rectPath(attributes);
    case "polygon":
      return pointsPath(attributes.points, true);
    case "polyline":
      return pointsPath(attributes.points, false);
    case "line":
      return `M${number(attributes.x1, 0)} ${number(attributes.y1, 0)}L${number(attributes.x2, 0)} ${number(attributes.y2, 0)}`;
    default:
      return "";
  }
}

const bodies = new Map<string, BodyElement[]>();

export function bodyElements(body: string): BodyElement[] {
  const cached = bodies.get(body);
  if (cached) return cached;
  const elements: BodyElement[] = [];
  for (const [, tag, attributeText] of body.matchAll(/<([a-zA-Z]+)\b([^>]*?)\/?>/g)) {
    const attributes: Record<string, string> = {};
    for (const [, key, value] of (attributeText ?? "").matchAll(/([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*"([^"]*)"/g)) attributes[key!] = value!;
    const d = pathData(tag!, attributes);
    if (d) elements.push({ d, transform: parseTransform(attributes.transform), attributes });
  }
  bodies.set(body, elements);
  return elements;
}

function layerMatrix(layer: SymbolLayer, weight: SymbolWeight, pointSize: number, nudge: readonly [number, number]) {
  const fit = fitFor(layer, weight);
  const [scale, aspect, fitDx, fitDy, strokeFit, rotate, flip] = fit;
  const dx = fitDx + nudge[0] / pointSize;
  const dy = fitDy + nudge[1] / pointSize;
  const unit = (scale * pointSize) / layer.viewBox;
  const sx = unit * aspect * (flip < 0 ? -1 : 1);
  const sy = unit / aspect;
  const half = layer.viewBox / 2;
  const matrix = compose(compose(compose(translation(dx * pointSize, dy * pointSize), rotation(rotate)), scaling(sx, sy)), translation(-half, -half));
  const strokeWidth = precise(Math.max(0, (strokeFit * pointSize) / unit));
  const halo = precise(strokeWidth + (2 * (layer.knockout ?? 0) * pointSize) / unit);
  return { matrix, strokeWidth, halo };
}

function resolveElement(layer: SymbolLayer, element: BodyElement, matrix: Matrix, strokeWidth: number, halo: number): VectorElement {
  const a = element.attributes;
  const groupFill = layer.paint === "fill";
  const groupStroke = layer.paint === "stroke" || strokeWidth > 0;
  const hasFill = a.fill !== undefined ? a.fill !== "none" : groupFill;
  const hasStroke = a.stroke !== undefined ? a.stroke !== "none" : groupStroke;
  const width = number(a["stroke-width"], strokeWidth);
  const opacity = number(a.opacity, 1) * (layer.opacity !== undefined && layer.opacity < 1 ? layer.opacity : 1);
  const full = compose(matrix, element.transform);
  return {
    d: element.d,
    matrix: [...full],
    evenOdd: a["fill-rule"] === "evenodd",
    fill: hasFill ? opacity * number(a["fill-opacity"], 1) : 0,
    stroke: hasStroke && width > 0 ? opacity * number(a["stroke-opacity"], 1) : 0,
    width,
    cap: a["stroke-linecap"] ?? "round",
    join: a["stroke-linejoin"] ?? "round",
    dashes: a["stroke-dasharray"] && a["stroke-dasharray"] !== "none" ? numbersIn(a["stroke-dasharray"]) : [],
    dashOffset: number(a["stroke-dashoffset"], 0),
    maskFill: a.fill !== "none",
    maskStroke: a.stroke !== "none",
    maskWidth: number(a["stroke-width"], halo),
  };
}

const icons = new Map<string, VectorIcon | null>();

export function vectorIcon(name: string, pointSize: number = NATIVE_DEFAULT_POINT_SIZE, weight: SymbolWeight = "regular"): VectorIcon | null {
  const key = `${name}|${weight}|${pointSize}`;
  const cached = icons.get(key);
  if (cached !== undefined) return cached;
  const layers = symbolLayers(name);
  if (!layers || !(pointSize > 0)) {
    icons.set(key, null);
    return null;
  }
  const nudge = symbolNudge(name, weight, pointSize);
  let drawnBefore = false;
  const resolved: VectorLayer[] = layers.map((layer) => {
    const { matrix, strokeWidth, halo } = layerMatrix(layer, weight, pointSize, nudge);
    const cutOnly = layer.opacity === 0;
    const cut = Boolean(layer.knockout || cutOnly) && drawnBefore;
    if (!cutOnly) drawnBefore = true;
    return { draw: !cutOnly, cut, elements: bodyElements(layer.body).map((element) => resolveElement(layer, element, matrix, strokeWidth, halo)) };
  });
  const icon = { key, layers: resolved };
  icons.set(key, icon);
  return icon;
}
