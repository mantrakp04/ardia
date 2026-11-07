import { capture } from "./telemetry";

type CustomizeState = { active: boolean; code: string | null };
type Outbound = { type: "ardia-demo:ready" } | { type: "ardia-demo:engaged" } | ({ type: "ardia-demo:customize-state" } & CustomizeState);

const DESKTOP_LOGICAL_WIDTH = 1100;
const PHONE_LOGICAL_WIDTH = 640;
const PHONE_BOX_WIDTH = 400;
const DESKTOP_BOX_WIDTH = 860;
const NUDGE_DELAY_MS = 900;
const FAR_SCREENS = 1;
const COPIED_FOR_MS = 1800;

const root = document.querySelector<HTMLElement>("[data-demo]");
const stage = root?.querySelector<HTMLElement>("[data-demo-stage]");
const frame = stage?.querySelector<HTMLIFrameElement>(".demo-frame");
const poster = root?.querySelector<HTMLElement>("[data-demo-poster]");
const bar = document.querySelector<HTMLElement>("[data-demo-controls]");

function minLogicalWidth(boxWidth: number) {
  const t = Math.min(1, Math.max(0, (boxWidth - PHONE_BOX_WIDTH) / (DESKTOP_BOX_WIDTH - PHONE_BOX_WIDTH)));
  return PHONE_LOGICAL_WIDTH + t * (DESKTOP_LOGICAL_WIDTH - PHONE_LOGICAL_WIDTH);
}

function fit(frame: HTMLIFrameElement, box: HTMLElement) {
  const { width, height } = box.getBoundingClientRect();
  if (!width || !height) return;
  const logicalWidth = Math.max(width, minLogicalWidth(width));
  const scale = width / logicalWidth;
  frame.style.width = `${logicalWidth}px`;
  frame.style.height = `${height / scale}px`;
  frame.style.transform = `scale(${scale})`;
  box.style.setProperty("--demo-scale", String(scale));
}

function wireCustomize(frame: HTMLIFrameElement, panel: HTMLElement) {
  const button = panel.querySelector<HTMLButtonElement>("[data-demo-customize]");
  const label = panel.querySelector<HTMLElement>("[data-demo-customize-label]");
  const box = panel.querySelector<HTMLElement>("[data-demo-code]");
  const value = panel.querySelector<HTMLElement>("[data-demo-code-value]");
  const copy = panel.querySelector<HTMLButtonElement>("[data-demo-copy]");
  let code: string | null = null;
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  button?.addEventListener("mousedown", (e) => e.preventDefault());
  button?.addEventListener("click", () => {
    root?.setAttribute("data-engaged", "");
    frame.focus();
    frame.contentWindow?.postMessage({ type: "ardia-demo:customize" }, location.origin);
  });
  copy?.addEventListener("click", () => {
    if (!code) return;
    const done = () => {
      copy.textContent = "Copied";
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => (copy.textContent = "Copy"), COPIED_FOR_MS);
    };
    if (navigator.clipboard) void navigator.clipboard.writeText(code).then(done, () => value && getSelection()?.selectAllChildren(value));
    else if (value) getSelection()?.selectAllChildren(value);
  });

  return (state: CustomizeState) => {
    if (button) button.disabled = state.active;
    if (label) label.textContent = state.active ? "Customizing…" : state.code ? "Customize again" : "Customize it";
    if (!state.code || state.code === code) return;
    const first = code === null;
    code = state.code;
    if (value) value.textContent = code;
    if (box) box.hidden = false;
    if (copy) copy.textContent = "Copy";
    capture("demo_setup_code_shown", { again: !first });
  };
}

function watchForNudge(frame: HTMLIFrameElement, box: HTMLElement) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const seen = new IntersectionObserver(
    (entries) => {
      clearTimeout(timer);
      if (!entries.some((e) => e.isIntersecting)) return;
      timer = setTimeout(() => {
        seen.disconnect();
        if (root?.dataset.engaged === undefined) frame.contentWindow?.postMessage({ type: "ardia-demo:nudge" }, location.origin);
      }, NUDGE_DELAY_MS);
    },
    { threshold: 0.6 },
  );
  seen.observe(box);
}

function restWhileFar(box: HTMLElement) {
  new IntersectionObserver(
    (entries) => {
      const far = !entries[entries.length - 1].isIntersecting;
      if (far !== box.hasAttribute("data-far")) box.toggleAttribute("data-far", far);
    },
    { rootMargin: `${FAR_SCREENS * 100}% 0px` },
  ).observe(box);
}

function start(root: HTMLElement, box: HTMLElement, frame: HTMLIFrameElement) {
  fit(frame, box);
  new ResizeObserver(() => fit(frame, box)).observe(box);
  restWhileFar(box);

  const showCustomize = bar ? wireCustomize(frame, bar) : null;
  const goLive = () => {
    if (root.dataset.live === "") return;
    root.dataset.live = "";
    poster?.setAttribute("inert", "");
    if (bar) bar.hidden = false;
    document.querySelector("[data-band-lead]")?.replaceChildren("That was a demo. ");
    watchForNudge(frame, box);
  };
  addEventListener("message", (event: MessageEvent<Outbound>) => {
    if (event.source !== frame.contentWindow || event.origin !== location.origin || !event.data || typeof event.data !== "object") return;
    if (event.data.type === "ardia-demo:ready") goLive();
    if (event.data.type === "ardia-demo:engaged") root.setAttribute("data-engaged", "");
    if (event.data.type === "ardia-demo:customize-state") showCustomize?.(event.data);
  });
  frame.contentWindow?.postMessage({ type: "ardia-demo:hello" }, location.origin);
}

if (root && stage && frame) start(root, stage, frame);
