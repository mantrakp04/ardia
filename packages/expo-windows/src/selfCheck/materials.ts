import { createElement, isValidElement, type ComponentType } from "react";
import { requireNativeModule } from "../modules";
import { gradientColors } from "../views/Bands";
import { bubblePath, NativeMaterialBlur, NativeMaterialGradient, NativeWindowMaterial, type MaterialsNative } from "../views/nativeMaterials";
import { viewOnWindows } from "../views/registry";
import { expectEqual, expectTrue, type Check } from "./check";

const materials = () => requireNativeModule<MaterialsNative>("ArdiaMaterials");

const WINDOW_MATERIALS = ["micaAlt", "mica", "acrylic"];
const VIEWS_WITH_MATERIALS = ["ArdiaVisualEffect", "ArdiaGlassEffect", "ArdiaPopoverBubble", "ArdiaWindowBackdrop", "ArdiaThemeSwatch"];
const MATERIAL_PROPS: Record<string, Record<string, unknown>> = {
  ArdiaVisualEffect: { material: "popover", cornerRadius: 12 },
  ArdiaGlassEffect: { cornerRadius: 10, glassStyle: "regular", tint: "#FF000040" },
  ArdiaPopoverBubble: { material: "menu", arrowEdge: "top", arrowX: 40, cornerRadius: 12 },
  ArdiaWindowBackdrop: { vibrancy: true, colors: ["#000000", "#FFFFFF"], themeColors: [0.1, 0.2, 0.3, 1, 0.4, 0.5, 0.6, 1, 0.9, 0.2, 0.1, 1], themeBaseAlpha: 0.3 },
  ArdiaThemeSwatch: { colors: [0.1, 0.2, 0.3, 1, 0.4, 0.5, 0.6, 1], angle: 135 },
};

const isComponent = (value: unknown) => typeof value === "function" || typeof value === "string" || (typeof value === "object" && value !== null && "$$typeof" in value);

function expectPath(answer: unknown, allowed: string[], what: string) {
  expectTrue(answer && typeof answer === "object", `${what}: no answer`);
  const { path, reason } = answer as { path?: unknown; reason?: unknown };
  expectTrue(typeof path === "string" && allowed.includes(path), `${what}: path ${JSON.stringify(path)} is not one of ${allowed.join(", ")}`);
  expectTrue(typeof reason === "string", `${what}: reason is not a string`);
  console.info(`[ardia windows] materials: ${what} took ${path}${reason ? ` (${reason})` : ""}`);
}

export const checks: Check[] = [
  {
    name: "materials: the module answers which paths this machine has",
    run() {
      const answer = materials().capabilities() as unknown;
      expectTrue(answer && typeof answer === "object" && !(answer instanceof Promise), "capabilities() did not answer synchronously");
      const caps = answer as Record<string, unknown>;
      for (const key of ["systemBackdrop", "systemBackdropSupported", "inWindowBlur", "gradient", "background"]) expectTrue(typeof caps[key] === "boolean", `${key} is not a boolean`);
      const build = caps.build;
      expectTrue(typeof build === "number" && Number.isInteger(build) && build > 0, `build ${JSON.stringify(build)} is not a Windows build number`);
      expectEqual(caps.systemBackdropSupported, build >= 22621, "system backdrop support follows the build");
      expectEqual(caps.systemBackdrop, caps.systemBackdropSupported === true && caps.background !== true, "system backdrop is off in a background instance");
      console.info(`[ardia windows] materials: ${JSON.stringify(caps)}`);
    },
  },
  {
    name: "materials: every window material on the self-check window resolves",
    async run() {
      const caps = materials().capabilities();
      for (const material of WINDOW_MATERIALS) {
        const answer = await materials().applyWindowMaterial("", material);
        expectPath(answer, caps.systemBackdrop ? [material, "flat"] : ["flat"], `window material ${material}`);
        const cleared = await materials().clearWindowMaterial("");
        expectEqual(cleared, answer.path !== "flat", `clearing ${material}`);
      }
      expectPath(await materials().applyWindowMaterial("no-such-window-id", "mica"), ["flat"], "window material on a missing window");
      expectEqual(await materials().clearWindowMaterial("no-such-window-id"), false, "clearing a missing window");
    },
  },
  {
    name: "materials: blur and gradient brushes build on the UI thread",
    async run() {
      const caps = materials().capabilities();
      const blur = await materials().probeBlur();
      expectPath(blur, ["blur", "flat"], "in-window blur");
      expectTrue(["saturated", "tinted", "plain", "flat"].includes(String(blur.step)), `in-window blur step ${JSON.stringify(blur.step)} is unknown`);
      console.info(`[ardia windows] materials: in-window blur reached step ${blur.step}; in-window blur available: ${caps.inWindowBlur}`);
      expectPath(await materials().probeGradient(), ["gradient"], "gradient");
    },
  },
  {
    name: "materials: native view names resolve to components",
    run() {
      for (const [name, view] of [
        ["ArdiaWindowMaterial", NativeWindowMaterial],
        ["ArdiaMaterialBlur", NativeMaterialBlur],
        ["ArdiaMaterialGradient", NativeMaterialGradient],
      ] as const) {
        expectTrue(isComponent(view), `${name} is not a host component`);
      }
      for (const name of VIEWS_WITH_MATERIALS) {
        const view = viewOnWindows(name);
        expectTrue(isComponent(view), `${name} is not a component`);
        expectTrue(isValidElement(createElement(view as ComponentType<Record<string, unknown>>, MATERIAL_PROPS[name] ?? {})), `${name} made no element`);
      }
    },
  },
  {
    name: "materials: bubble outlines and gradient stops are well formed",
    run() {
      const plain = bubblePath(200, 120, 12, "none", 0, 20, 9);
      expectTrue(plain.startsWith("M ") && plain.endsWith("Z") && !plain.includes("Q"), `plain bubble: ${plain}`);
      const arrow = bubblePath(200, 120, 12, "top", 100, 20, 9);
      expectEqual((arrow.match(/Q/g) ?? []).length, 3, "arrow joints");
      const below = bubblePath(200, 120, 12, "bottom", 100, 20, 9);
      expectTrue(/Q 100 120 /.test(below), `bottom arrow tip is not at the bottom edge: ${below}`);
      expectEqual(bubblePath(0, 0, 12, "top", 0, 20, 9), "", "empty bubble");
      expectEqual(gradientColors([], 16), [], "no stops");
      expectEqual(gradientColors([[1, 0, 0, 1]], 16), [1, 0, 0, 1], "one stop");
      const colors = gradientColors([[0, 0, 0, 1], [1, 1, 1, 1]], 16);
      expectEqual(colors.length, 64, "sixteen sampled stops");
      expectTrue(colors.every(Number.isFinite), "non-finite gradient stop");
    },
  },
];
