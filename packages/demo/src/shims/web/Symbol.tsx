import { useEffect, useId, useMemo, useReducer } from "react";
import { View, type ViewProps } from "react-native";
import { noteMissing } from "../missing";
import { symbolLayers, symbolNudge } from "./symbols/data";
import { knownInkShift, measureInkShift } from "./symbols/ink";
import { symbolMarkup, type SymbolWeight } from "./symbols/render";

export type SymbolProps = ViewProps & {
  name: string;
  size?: number;
  weight?: SymbolWeight;
  color?: string;
  centerInk?: boolean;
};

const NATIVE_DEFAULT_POINT_SIZE = 14;
const CANVAS_IN_POINTS = 3;
const NO_SHIFT = [0, 0] as const;

export function Symbol({ name, size = NATIVE_DEFAULT_POINT_SIZE, weight = "regular", color, centerInk, style, ...props }: SymbolProps) {
  const id = `symbol-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const layers = symbolLayers(name);
  if (!layers) noteMissing(`symbol ${name}`);
  const canvas = Math.ceil(size * CANVAS_IN_POINTS);
  const markup = useMemo(
    () => (layers ? symbolMarkup(layers, { pointSize: size, weight, width: canvas, height: canvas, color: color ?? "currentColor", id, nudge: symbolNudge(name, weight, size) }) : ""),
    [layers, name, size, weight, canvas, color, id],
  );
  const inkKey = `${name}|${weight}|${size}`;
  const [, measuredAgain] = useReducer((count: number) => count + 1, 0);
  const shift = (centerInk && knownInkShift(inkKey)) || NO_SHIFT;
  useEffect(() => {
    if (!centerInk || !layers || knownInkShift(inkKey)) return;
    let current = true;
    void measureInkShift(inkKey, markup, canvas).then((measured) => {
      if (measured && current) measuredAgain();
    });
    return () => {
      current = false;
    };
  }, [centerInk, layers, inkKey, markup, canvas]);
  return (
    <View pointerEvents="none" {...props} style={style}>
      {layers ? (
        <span aria-hidden data-symbol={name} style={{ position: "absolute", left: "50%", top: "50%", width: 0, height: 0, pointerEvents: "none" }}>
          <span
            style={{ position: "absolute", left: -canvas / 2 + shift[0], top: -canvas / 2 + shift[1], width: canvas, height: canvas, display: "block" }}
            dangerouslySetInnerHTML={{ __html: markup }}
          />
        </span>
      ) : null}
    </View>
  );
}
