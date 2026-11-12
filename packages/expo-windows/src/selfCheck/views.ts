import { createElement, isValidElement, type ComponentType } from "react";
import { renderOnStage } from "./stage";
import { flatStops, mixOklab, parseColor, sampleStops } from "../views/color";
import { viewsDrawnInJs } from "../views/index";
import { expectEqual, expectTrue, type Check } from "./check";

const EXPECTED = [
  "ArdiaSurface",
  "ArdiaFadeLabel",
  "ArdiaActivitySpinner",
  "ArdiaVisualEffect",
  "ArdiaGlassEffect",
  "ArdiaGlassGroup",
  "ArdiaPopoverBubble",
  "ArdiaWindowBackdrop",
  "ArdiaContextMenuArea",
  "ArdiaOutsidePressArea",
  "ArdiaFileDrag",
  "ArdiaMagnifyArea",
  "ArdiaFileDrop",
  "ArdiaThemeSwatch",
  "ArdiaDockSelection",
  "ArdiaWindowProfile",
  "ArdiaSwipe",
];

const MINIMAL_PROPS: Record<string, Record<string, unknown>> = {
  ArdiaFadeLabel: { text: "" },
  ArdiaWindowBackdrop: { colors: ["#000000", "#FFFFFF"] },
  ArdiaThemeSwatch: { colors: [] },
  ArdiaDockSelection: { dark: true },
  ArdiaWindowProfile: { profile: "", neighbours: [] },
};

const isComponent = (value: unknown) => typeof value === "function" || (typeof value === "object" && value !== null && "$$typeof" in value);

const rounded = (values: number[]) => values.map((value) => Math.round(value * 1000) / 1000);

export const checks: Check[] = [
  {
    name: "views drawn in JS cover every native view name",
    run() {
      expectEqual(EXPECTED.filter((name) => !viewsDrawnInJs.has(name)), [], "missing views");
    },
  },
  {
    name: "views drawn in JS are components that make elements",
    run() {
      for (const [name, component] of viewsDrawnInJs) {
        expectTrue(isComponent(component), `${name} is not a component`);
        for (const props of [{}, MINIMAL_PROPS[name] ?? {}, { style: { flex: 1 }, children: null, testID: name }]) {
          const element = createElement(component as ComponentType<Record<string, unknown>>, props);
          expectTrue(isValidElement(element), `${name} made no element`);
        }
      }
    },
  },
  {
    name: "views drawn in JS render in a window without throwing",
    async run() {
      for (const [name, component] of viewsDrawnInJs) {
        await renderOnStage(createElement(component as ComponentType<Record<string, unknown>>, MINIMAL_PROPS[name] ?? {}), name);
      }
    },
  },
  {
    name: "view colors parse hex and rgba",
    run() {
      expectEqual(rounded(parseColor("#FF000080") ?? []), [1, 0, 0, 0.502], "#FF000080");
      expectEqual(rounded(parseColor("#0f0") ?? []), [0, 1, 0, 1], "#0f0");
      expectEqual(rounded(parseColor("rgba(0, 0, 255, 0.5)") ?? []), [0, 0, 1, 0.5], "rgba");
      expectEqual(parseColor("blue"), null, "named color");
      expectEqual(parseColor(undefined), null, "missing color");
    },
  },
  {
    name: "view gradients mix in oklab and read flat theme stops",
    run() {
      expectEqual(rounded(mixOklab([1, 0, 0, 1], [1, 0, 0, 1], 0.5)), [1, 0, 0, 1], "same color");
      expectEqual(rounded(sampleStops([[0, 0, 0, 1], [1, 1, 1, 1]], 1)), [1, 1, 1, 1], "last stop");
      expectEqual(flatStops([0.1, 0.2, 0.3, 1, 0.4, 0.5, 0.6, 1, 1]).length, 2, "flat stops");
      expectEqual(flatStops("bad"), [], "bad stops");
    },
  },
];
