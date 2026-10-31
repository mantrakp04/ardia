import { curve } from "../../ui/motion";

export const sceneMs = {
  tabs: 1200,
  address: 1100,
  commandBar: 1200,
  newTab: 1300,
  newTabPosition: 1100,
  tidy: 1500,
  quit: 1500,
  windows: 1400,
  appearance: 1200,
  style: 1300,
  siteColor: 1300,
  switcher: 1300,
  typed: 1300,
  block: 1300,
  links: 1500,
  autoBadge: 900,
} as const;

export const mockMotion = {
  move: { duration: 340, easing: curve.outCubic },
  fade: { duration: 380, easing: curve.outCubic },
  focus: { duration: 220, easing: curve.outQuad },
} as const;

export const tabTints = {
  notes: "#4E8A5B",
  mail: "#3A7BEA",
  maps: "#E8664A",
  docs: "#7C6BD6",
  music: "#E0457B",
  cooking: "#E3A21A",
  github: "#24292F",
  newTab: "#8E8E93",
  blank: "#A1A1A6",
} as const;

export const articleTints = {
  notes: {
    band: ["#E6EEE3", "#1E2722"],
    sky: ["#CFE2EC", "#2A3946"],
    sun: ["#F6D58C", "#CDAE63"],
    far: ["#A8C8A2", "#3E5A45"],
    near: ["#7DAA83", "#2F4839"],
    sea: ["#9CC3D4", "#2D4A59"],
  },
  trip: {
    band: ["#E5ECF6", "#1C2330"],
    sky: ["#F4D9C2", "#4A3439"],
    sun: ["#F2A86A", "#C77F4B"],
    far: ["#E7B9A0", "#5B4044"],
    near: ["#C98F7A", "#43303A"],
    sea: ["#B7CFE0", "#2C3E52"],
  },
} as const;

export const mockPage = {
  dark: { page: "#161718", ink: "#ECECEE", inkDim: "rgba(236,236,238,0.62)", inkFaint: "rgba(236,236,238,0.4)" },
  light: { page: "#FFFFFF", ink: "#1D1D1F", inkDim: "rgba(29,29,31,0.62)", inkFaint: "rgba(29,29,31,0.42)" },
} as const;

export const mockInk = {
  lightsRim: "rgba(0,0,0,0.14)",
  glyphOnTint: "#FFFFFF",
  cursorRim: "#FFFFFF",
  cursor: "#111111",
  moon: "#C7CCE6",
  sun: "#E3A21A",
  pressFlash: "rgba(0,0,0,0.12)",
  windowEdge: { dark: "#FFFFFF2E", light: "#0000002A" },
  appWindowEdge: { dark: "#FFFFFF26", light: "#0000001F" },
  frameEdge: { dark: "#FFFFFF33", light: "#00000026" },
  desktop: { light: ["#D9DCE4", "#C4C9D6"], dark: ["#1C1D22", "#2B2D35"] },
  chat: { dark: "#1E1E1E", light: "#FFFFFF" },
  bubbleMine: "#2F7BF6",
  bubbleMineText: "#FFFFFF",
  bubble: { dark: "#3A3A3C", light: "#E9E9EB" },
  ad: {
    fill: { light: "#F6F1DE", dark: "#2A2719" },
    border: { dark: "#5A5130", light: "#E2D6A8" },
    label: { dark: "#B9A867", light: "#9C8A45" },
  },
} as const;
