import type { MetricWithAttribution } from "web-vitals/attribution";
import { capture, onHide, sessionId, windowId, type Props } from "./core";

const METRICS = ["LCP", "CLS", "FCP", "INP"] as const;
const FLUSH_MS = 5000;
const MAX_MS = 15 * 60 * 1000;

const MAX_SCRIPTS = 5;
const MAX_URL = 200;
const MAX_NAME = 120;

const buffer = new Map<string, MetricWithAttribution>();
let timer = 0;

const clip = (s: string | undefined, max: number) => (s ?? "").slice(0, max);
const scriptURL = (url: string | undefined) => clip((url ?? "").split(/[?#]/)[0], MAX_URL);
const ms = (n: number | undefined) => (Number.isFinite(n) ? Math.round(n as number) : null);

function scriptTiming(s: PerformanceScriptTiming): Props {
  return {
    sourceURL: scriptURL(s.sourceURL),
    sourceFunctionName: clip(s.sourceFunctionName, MAX_NAME),
    invoker: clip(s.invoker, MAX_NAME),
    invokerType: s.invokerType,
    duration: ms(s.duration),
    forcedStyleAndLayoutDuration: ms(s.forcedStyleAndLayoutDuration),
    windowAttribution: s.windowAttribution,
  };
}

function scriptAttribution(m: MetricWithAttribution): Props {
  if (m.name !== "INP") return {};
  const { longestScript, longAnimationFrameEntries = [] } = m.attribution;
  const out: Props = {};
  if (longestScript) {
    const s = scriptTiming(longestScript.entry);
    for (const [k, v] of Object.entries(s)) out[`longestScript${k[0]!.toUpperCase()}${k.slice(1)}`] = v;
    out.longestScriptSubpart = longestScript.subpart;
    out.longestScriptIntersectingDuration = ms(longestScript.intersectingDuration);
  }
  const scripts = longAnimationFrameEntries.flatMap((frame) => [...(frame.scripts ?? [])]);
  if (scripts.length) {
    out.loafCount = longAnimationFrameEntries.length;
    out.loafScriptCount = scripts.length;
    out.loafScripts = scripts
      .sort((a, b) => b.duration - a.duration)
      .slice(0, MAX_SCRIPTS)
      .map(scriptTiming);
  }
  return out;
}

function describe(m: MetricWithAttribution): Props {
  const attribution: Props = {};
  for (const [k, v] of Object.entries(m.attribution ?? {})) if (v === null || ["string", "number", "boolean"].includes(typeof v)) attribution[k] = v;
  try {
    Object.assign(attribution, scriptAttribution(m));
  } catch {}
  return {
    name: m.name,
    value: m.value,
    delta: m.delta,
    id: m.id,
    rating: m.rating,
    navigationType: m.navigationType,
    attribution,
    timestamp: Date.now(),
    $current_url: location.href,
    $session_id: sessionId(),
    $window_id: windowId,
  };
}

function flush() {
  clearTimeout(timer);
  timer = 0;
  if (!buffer.size) return;
  const props: Props = {};
  for (const [name, m] of buffer) {
    props[`$web_vitals_${name}_value`] = m.value;
    props[`$web_vitals_${name}_event`] = describe(m);
  }
  buffer.clear();
  capture("$web_vitals", props);
}

function onMetric(m: MetricWithAttribution) {
  if (!Number.isFinite(m.value) || m.value < 0 || m.value >= MAX_MS) return;
  buffer.set(m.name, m);
  if (METRICS.every((n) => buffer.has(n))) flush();
  else if (!timer) timer = window.setTimeout(flush, FLUSH_MS);
}

export function startVitals() {
  onHide(flush);
  import("web-vitals/attribution")
    .then(({ onLCP, onCLS, onFCP, onINP }) => {
      onLCP(onMetric);
      onCLS(onMetric);
      onFCP(onMetric);
      onINP(onMetric);
    })
    .catch(() => {});
}
