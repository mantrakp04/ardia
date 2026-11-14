import { expectEqual, expectTrue, type Check } from "./check";
import { vectorIcon, vectorSymbolNames, type SymbolWeight, type VectorIcon } from "../symbol/layers";

const KNOWN = ["chevron.left", "xmark", "magnifyingglass", "plus", "gearshape", "sidebar.left", "arrow.clockwise", "star.fill"];
const WEIGHTS: SymbolWeight[] = ["light", "regular", "medium", "semibold", "bold"];
const PATH_START = /^\s*[Mm]/;
const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

const drawablePath = (d: string) => PATH_START.test(d) && (d.match(NUMBER)?.length ?? 0) >= 3;

function expectDrawable(icon: VectorIcon | null, what: string): asserts icon is VectorIcon {
  expectTrue(icon, `${what}: no layers`);
  expectTrue(icon.layers.length > 0, `${what}: empty layer list`);
  let painted = 0;
  for (const layer of icon.layers) {
    for (const element of layer.elements) {
      expectTrue(drawablePath(element.d), `${what}: path data ${JSON.stringify(element.d.slice(0, 40))} is not drawable`);
      expectTrue(element.matrix.length === 6 && element.matrix.every(Number.isFinite), `${what}: bad matrix ${JSON.stringify(element.matrix)}`);
      expectTrue([element.fill, element.stroke, element.width, element.maskWidth, element.dashOffset, ...element.dashes].every(Number.isFinite), `${what}: non-finite paint`);
      if (layer.draw && (element.fill > 0 || (element.stroke > 0 && element.width > 0))) painted += 1;
    }
  }
  expectTrue(painted > 0, `${what}: nothing is painted`);
}

export const checks: Check[] = [
  {
    name: "symbol: known names resolve to drawable layers",
    run() {
      for (const name of KNOWN) expectDrawable(vectorIcon(name, 14, "regular"), name);
    },
  },
  {
    name: "symbol: every bundled symbol resolves at every weight",
    run() {
      expectTrue(vectorSymbolNames.length > 100, `only ${vectorSymbolNames.length} symbols bundled`);
      for (const name of vectorSymbolNames) for (const weight of WEIGHTS) expectDrawable(vectorIcon(name, 12, weight), `${name} ${weight}`);
    },
  },
  {
    name: "symbol: size and weight give their own cache keys",
    run() {
      const small = vectorIcon("xmark", 11, "regular");
      const large = vectorIcon("xmark", 22, "bold");
      expectTrue(small && large, "xmark did not resolve");
      expectTrue(small.key !== large.key, "xmark keys collide");
      expectEqual(vectorIcon("xmark", 11, "regular"), small, "xmark at 11 regular");
      const scale = (icon: VectorIcon) => Math.hypot(icon.layers[0]!.elements[0]!.matrix[0]!, icon.layers[0]!.elements[0]!.matrix[1]!);
      expectTrue(scale(large) > scale(small) * 1.8, `xmark does not grow with size: ${scale(small)} to ${scale(large)}`);
    },
  },
  {
    name: "symbol: an unknown name resolves to nothing",
    run() {
      expectEqual(vectorIcon("ardia.no.such.symbol", 14, "regular"), null, "unknown symbol");
      expectEqual(vectorIcon("", 14, "regular"), null, "empty symbol name");
      expectEqual(vectorIcon("xmark", 0, "regular"), null, "zero size");
    },
  },
];
