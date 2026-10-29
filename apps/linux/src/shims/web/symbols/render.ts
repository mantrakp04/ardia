export type SymbolWeight = "light" | "regular" | "medium" | "semibold" | "bold";

export type LayerFit = readonly [scale: number, aspect: number, dx: number, dy: number, stroke: number, rotate: number, flip: number];

export type SymbolLayer = {
  body: string;
  viewBox: number;
  paint: "stroke" | "fill";
  opacity?: number;
  knockout?: number;
  fits: Partial<Record<SymbolWeight, LayerFit>> & { regular: LayerFit };
};

const WEIGHT_ORDER: SymbolWeight[] = ["light", "regular", "medium", "semibold", "bold"];

export function fitFor(layer: SymbolLayer, weight: SymbolWeight): LayerFit {
  const exact = layer.fits[weight];
  if (exact) return exact;
  const index = WEIGHT_ORDER.indexOf(weight);
  const nearest = WEIGHT_ORDER.map((candidate, i) => ({ fit: layer.fits[candidate], distance: Math.abs(i - index) + (i > index ? 0.5 : 0) }))
    .filter((entry): entry is { fit: LayerFit; distance: number } => entry.fit !== undefined)
    .sort((a, b) => a.distance - b.distance)[0];
  return nearest?.fit ?? layer.fits.regular;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const precise = (n: number) => Number(n.toPrecision(5));
const XML_ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
const attribute = (value: string) => value.replace(/[&<>"']/g, (character) => XML_ENTITIES[character]!);

function layerTransform(layer: SymbolLayer, fit: LayerFit, pointSize: number, width: number, height: number, nudge: readonly [number, number]) {
  const [scale, aspect, fitDx, fitDy, , rotate, flip] = fit;
  const dx = fitDx + nudge[0] / pointSize;
  const dy = fitDy + nudge[1] / pointSize;
  const unit = (scale * pointSize) / layer.viewBox;
  const sx = unit * aspect * (flip < 0 ? -1 : 1);
  const sy = unit / aspect;
  const half = layer.viewBox / 2;
  return `translate(${round(width / 2 + dx * pointSize)} ${round(height / 2 + dy * pointSize)}) rotate(${round(rotate)}) scale(${precise(sx)} ${precise(sy)}) translate(${-half} ${-half})`;
}

function paintAttributes(layer: SymbolLayer, strokeWidth: number, color: string) {
  const width = precise(Math.max(0, strokeWidth));
  if (layer.paint === "stroke") return `fill="none" stroke="${color}" stroke-width="${width}"`;
  return width > 0 ? `fill="${color}" stroke="${color}" stroke-width="${width}"` : `fill="${color}" stroke="none"`;
}

export function symbolMarkup(
  layers: readonly SymbolLayer[],
  options: { pointSize: number; weight: SymbolWeight; width: number; height: number; color: string; id: string; nudge?: readonly [number, number] },
): string {
  const { pointSize, weight, width, height, nudge = [0, 0] } = options;
  const color = attribute(options.color);
  const id = options.id.replace(/[^a-zA-Z0-9_-]/g, "_") || "symbol";
  let content = "";
  let defs = "";
  layers.forEach((layer, index) => {
    const fit = fitFor(layer, weight);
    const transform = layerTransform(layer, fit, pointSize, width, height, nudge);
    const unit = (fit[0] * pointSize) / layer.viewBox;
    const strokeWidth = (fit[4] * pointSize) / unit;
    const body = layer.body;
    const cutOnly = layer.opacity === 0;
    if ((layer.knockout || cutOnly) && content) {
      const halo = strokeWidth + (2 * (layer.knockout ?? 0) * pointSize) / unit;
      const maskId = `${id}-k${index}`;
      defs += `<mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#fff"/><g transform="${transform}" color="#000" fill="#000" stroke="#000" stroke-width="${precise(halo)}">${body}</g></mask>`;
      content = `<g mask="url(#${maskId})">${content}</g>`;
    }
    if (cutOnly) return;
    const opacity = layer.opacity !== undefined && layer.opacity < 1 ? ` opacity="${layer.opacity}"` : "";
    content += `<g transform="${transform}" ${paintAttributes(layer, strokeWidth, color)}${opacity}>${body}</g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true" style="display:block;overflow:visible" color="${color}" stroke-linecap="round" stroke-linejoin="round">${defs ? `<defs>${defs}</defs>` : ""}${content}</svg>`;
}
