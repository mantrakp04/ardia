import { startSunrise } from "./meadow/clock";
import { CYCLE_STOPS, MOON_RANGE, SUNRISE_FROM, SUNRISE_TO } from "./meadow/cycle";
import { createMeadow } from "./meadow/scene";

type MeadowMessage = { state: "ready"; at: number } | { state: "failed" } | { state: "tone"; tone: string; halo: number };

interface MeadowHost {
  postMessage(message: MeadowMessage): void;
}

const host = (window as { webkit?: { messageHandlers?: { meadow?: MeadowHost } } }).webkit?.messageHandlers?.meadow;
const post = (message: MeadowMessage) => host?.postMessage(message);

const NIGHT = CYCLE_STOPS[2];
const DUSK = MOON_RANGE[0];
const opensAtNight = location.hash === "#night";

function onceOnScreen(callback: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(callback));
}

function watchFailure(canvas: HTMLCanvasElement) {
  const observer = new MutationObserver(() => {
    if (canvas.dataset.meadow !== "failed") return;
    observer.disconnect();
    post({ state: "failed" });
  });
  observer.observe(canvas, { attributes: true, attributeFilter: ["data-meadow"] });
}

function watchTone(title: HTMLElement) {
  let sent = "";
  const send = () => {
    const tone = title.dataset.tone ?? (opensAtNight ? "dark" : "light");
    const halo = Number.parseFloat(title.style.getPropertyValue("--halo")) || 0;
    const key = `${tone}:${halo}`;
    if (key === sent) return;
    sent = key;
    post({ state: "tone", tone, halo });
  };
  new MutationObserver(send).observe(title, { attributes: true, attributeFilter: ["data-tone", "style"] });
  send();
}

function boot(hero: HTMLElement) {
  const canvas = hero.querySelector<HTMLCanvasElement>("[data-meadow-canvas]");
  if (!canvas || !("WebGL2RenderingContext" in window)) return post({ state: "failed" });
  watchFailure(canvas);
  const title = hero.querySelector<HTMLElement>(".hero-title");
  if (title) watchTone(title);
  if (title && opensAtNight) title.dataset.tone = "dark";
  const meadow = createMeadow({
    canvas,
    hero,
    hint: null,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    opening: opensAtNight ? [DUSK, NIGHT] : [SUNRISE_FROM, SUNRISE_TO],
    onFirstFrame() {
      onceOnScreen(() => {
        hero.dataset.meadow = "ready";
        startSunrise(hero);
        post({ state: "ready", at: performance.now() });
      });
    },
  });
  if (!meadow) return post({ state: "failed" });
  Object.assign(window, { meadowNight: (night: boolean) => meadow.travelTo(night ? NIGHT : SUNRISE_TO) });
}

const hero = document.querySelector<HTMLElement>("[data-meadow]");
if (hero) boot(hero);
else post({ state: "failed" });
