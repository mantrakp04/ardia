export const HERO_FRAMES = [
  {
    name: "wider",
    capture: { width: 2400, height: 1000, dpr: 1, device: "mac", widths: [1600, 2400], budget: 90 * 1024 },
    media: ["(min-aspect-ratio: 16001/9000)", "(min-aspect-ratio: 13001/10000) and (min-width: 1991.01px)"],
    horizon: "65%",
  },
  {
    name: "wide",
    capture: { width: 1920, height: 1080, dpr: 1, device: "mac", widths: [1280, 1920], budget: 80 * 1024 },
    media: [
      "(min-aspect-ratio: 8001/5000) and (max-aspect-ratio: 16/9) and (max-width: 1991px)",
      "(min-aspect-ratio: 13001/10000) and (max-aspect-ratio: 8/5) and (min-width: 1716.01px) and (max-width: 1991px)",
    ],
    horizon: "65%",
  },
  {
    name: "laptop",
    capture: { width: 1440, height: 900, dpr: 2, device: "mac", widths: [1280, 1920], budget: 80 * 1024 },
    media: ["(min-aspect-ratio: 13001/10000) and (max-aspect-ratio: 8/5) and (max-width: 1716px)"],
    horizon: "65%",
  },
  {
    name: "mid",
    capture: { width: 1196, height: 920, dpr: 2, device: "mac", widths: [1100, 1600], budget: 70 * 1024 },
    media: ["(min-aspect-ratio: 9001/10000) and (max-aspect-ratio: 13/10)", "(max-aspect-ratio: 9/10) and (min-width: 820.01px)"],
    horizon: "65%",
  },
  {
    name: "tall",
    capture: { width: 390, height: 844, dpr: 3, device: "phone", widths: [440, 0], budget: 38 * 1024 },
    media: ["(max-aspect-ratio: 9/10) and (max-width: 820px)"],
    horizon: "67%",
  },
];

export const HERO_STATES = [
  { name: "dawn", reducedMotion: false, media: "(prefers-reduced-motion: no-preference)" },
  { name: "morning", reducedMotion: true, media: "(prefers-reduced-motion: reduce)" },
];
