import { useId, useMemo } from "react";
import { View, type ViewProps } from "react-native";
import { noteMissing } from "../missing";
import { symbolLayers, symbolNudge } from "./symbols/data";
import { symbolMarkup, type SymbolWeight } from "./symbols/render";
import { ardiaHost } from "../../host";

export type SymbolProps = ViewProps & {
  name: string;
  size?: number;
  weight?: SymbolWeight;
  color?: string;
};

const NATIVE_DEFAULT_POINT_SIZE = 14;
const CANVAS_IN_POINTS = 3;
const GLYPH_ANCHOR = 1;
type SymbolPolicy = { createHTML(markup: string): TrustedHTML };
type SymbolTrustedTypes = { createPolicy(name: string, rules: { createHTML(markup: string): string }): SymbolPolicy };
const trustedTypes = (globalThis as typeof globalThis & { trustedTypes?: SymbolTrustedTypes }).trustedTypes;
const symbolPolicy = ardiaHost && trustedTypes ? trustedTypes.createPolicy("ardia-symbols", { createHTML: (markup) => markup }) : null;

export function Symbol({ name, size = NATIVE_DEFAULT_POINT_SIZE, weight = "regular", color, style, ...props }: SymbolProps) {
  const id = `symbol-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const layers = symbolLayers(name);
  if (!layers) noteMissing(`symbol ${name}`);
  const canvas = Math.ceil(size * CANVAS_IN_POINTS);
  const markup = useMemo(
    () => {
      if (!layers) return "";
      const markup = symbolMarkup(layers, { pointSize: size, weight, width: canvas, height: canvas, color: color ?? "currentColor", id, nudge: symbolNudge(name, weight, size) });
      return symbolPolicy ? symbolPolicy.createHTML(markup) : markup;
    },
    [layers, name, size, weight, canvas, color, id],
  );
  return (
    <View pointerEvents="none" {...props} style={style}>
      {layers ? (
        <svg
          aria-hidden
          data-symbol={name}
          width={GLYPH_ANCHOR}
          height={GLYPH_ANCHOR}
          viewBox={`${canvas / 2} ${canvas / 2} ${GLYPH_ANCHOR} ${GLYPH_ANCHOR}`}
          overflow="visible"
          style={{ position: "absolute", left: "50%", top: "50%", display: "block", overflow: "visible", pointerEvents: "none" }}
          dangerouslySetInnerHTML={{ __html: markup }}
        />
      ) : null}
    </View>
  );
}
