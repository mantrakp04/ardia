import { useEffect, useRef, type CSSProperties } from "react";
import { observeOnscreen, observePixelSize, subscribeFrames } from "./clock";
import { GLSurface, type Uniforms } from "./surface";

export type UniformsAt = (css: [number, number], time: number) => Uniforms;

type Props = {
  fragment: string;
  uniformsAt: UniformsAt;
  animation?: { lastFrameTime: number };
  style?: CSSProperties;
  version?: unknown;
};

const MIN_FRAME_INTERVAL = 0.9 / 60;

const fill: CSSProperties = { position: "absolute", left: 0, top: 0, width: "100%", height: "100%", pointerEvents: "none" };

export function GLView({ fragment, uniformsAt, animation, style, version }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(uniformsAt);
  latest.current = uniformsAt;
  const view = useRef({ surface: null as GLSurface | null, css: [0, 0] as [number, number], time: 0, started: false, done: false, redraw: () => {} });

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const v = view.current;
    v.time = 0;
    v.started = false;
    v.done = false;
    const redraw = () => {
      if (v.surface && v.css[0] > 0 && v.css[1] > 0) v.surface.draw(latest.current(v.css, v.time));
    };
    v.redraw = redraw;
    const surface = new GLSurface(fragment, redraw);
    v.surface = surface;
    Object.assign(surface.canvas.style, { ...fill, display: "block" });
    el.appendChild(surface.canvas);

    const stopSize = observePixelSize(el, (css, pixels) => {
      v.css = css;
      surface.resize(pixels[0], pixels[1]);
      if (!animation || v.started) redraw();
    });

    let stopFrames = () => {};
    let stopOnscreen = () => {};
    if (animation) {
      let pending = 0;
      const tick = (dt: number) => {
        pending += dt;
        if (v.started && pending < MIN_FRAME_INTERVAL) return;
        v.time = v.started ? v.time + pending : 0;
        pending = 0;
        v.started = true;
        const finished = v.time >= animation.lastFrameTime;
        if (finished) v.time = animation.lastFrameTime;
        redraw();
        if (finished) {
          v.done = true;
          stopFrames();
          stopFrames = () => {};
        }
      };
      stopOnscreen = observeOnscreen(el, (visible) => {
        stopFrames();
        stopFrames = visible && !v.done ? subscribeFrames(tick) : () => {};
      });
    }

    return () => {
      stopOnscreen();
      stopFrames();
      stopSize();
      surface.canvas.remove();
      surface.dispose();
      v.surface = null;
    };
  }, [fragment, !!animation]);

  useEffect(() => {
    if (!animation) view.current.redraw();
  }, [version]);

  return <div ref={host} style={{ ...fill, ...style }} />;
}
