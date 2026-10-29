import posters from "../assets/hero/posters.json";
import { HERO_FRAMES, HERO_STATES } from "./heroFrames.mjs";

type Tone = "light" | "dark";

interface Captured {
  state: string;
  frame: string;
  width: number;
  height: number;
  files: { file: string; width: number; height: number }[];
  lqip: string;
  tones: Record<string, { tone: string; halo: number }>;
  sky: string;
  headerHalo: number;
}

const urls = import.meta.glob<string>("../assets/hero/*.webp", { query: "?url", import: "default", eager: true });

function frameAndState(poster: Captured) {
  const frame = HERO_FRAMES.find((f) => f.name === poster.frame);
  const state = HERO_STATES.find((s) => s.name === poster.state);
  if (!frame || !state)
    throw new Error(`src/assets/hero/posters.json has ${poster.state}-${poster.frame}, which src/data/heroFrames.mjs doesn't list: rerun scripts/hero-posters.mjs`);
  return { frame, state };
}

export interface HeroPoster {
  key: string;
  media: string;
  src: string;
  srcset: string;
  sizes: string;
  width: number;
  height: number;
  horizon: string;
  lqip: string;
  fallback: boolean;
  tones: Record<string, [Tone, string]>;
  sky: Tone;
  headerHalo: string;
}

const halo = (value: number) => (Math.round(value / 0.05) * 0.05).toFixed(2);

export const HERO_POSTERS: HeroPoster[] = (posters as Captured[]).map((poster) => {
  const { frame, state } = frameAndState(poster);
  const files = [...poster.files].sort((a, b) => a.width - b.width);
  const url = (file: string) => urls[`../assets/hero/${file}`];
  const aspect = poster.width / poster.height;
  return {
    key: `${poster.state}-${poster.frame}`,
    media: frame.media.map((query) => `${state.media} and ${query}`).join(", "),
    src: url(files[files.length - 1].file),
    srcset: files.map((file) => `${url(file.file)} ${file.width}w`).join(", "),
    sizes: `max(100vw, ${Math.ceil(aspect * 100)}vh)`,
    width: poster.width,
    height: poster.height,
    horizon: frame.horizon,
    lqip: poster.lqip,
    fallback: poster.state === "dawn" && poster.frame === "wide",
    tones: Object.fromEntries(Object.entries(poster.tones).map(([group, value]) => [group, [value.tone as Tone, halo(value.halo)]])),
    sky: poster.sky as Tone,
    headerHalo: halo(poster.headerHalo),
  };
});

export const HERO_POSTER_FALLBACK = HERO_POSTERS.find((poster) => poster.fallback)!;

const posterRule = (poster: HeroPoster) =>
  `.hero-poster{background-image:url("${poster.lqip}");background-position:50% ${poster.horizon}}.hero-poster img{object-position:50% ${poster.horizon}}`;

export const HERO_POSTER_CSS = [posterRule(HERO_POSTER_FALLBACK), ...HERO_POSTERS.map((poster) => `@media ${poster.media}{${posterRule(poster)}}`)].join("");
