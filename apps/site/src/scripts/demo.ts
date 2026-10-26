import { track } from "./track";

type CustomizeState = { active: boolean; code: string | null };
type Outbound = { type: "ardia-demo:ready" } | { type: "ardia-demo:engaged" } | ({ type: "ardia-demo:customize-state" } & CustomizeState);

const DESKTOP_LOGICAL_WIDTH = 1100;
const PHONE_LOGICAL_WIDTH = 640;
const PHONE_BOX_WIDTH = 400;
const DESKTOP_BOX_WIDTH = 860;
const REVEAL_FALLBACK_MS = 1500;
const NUDGE_DELAY_MS = 900;
const FAR_SCREENS = 1;
const COPIED_FOR_MS = 1800;

const root = document.querySelector<HTMLElement>("[data-demo]");
const stage = root?.querySelector<HTMLElement>("[data-demo-stage]");
const poster = root?.querySelector<HTMLElement>("[data-demo-poster]");
const bar = document.querySelector<HTMLElement>("[data-demo-controls]");
const tilt = root?.closest<HTMLElement>("[data-settle]");
const settles = matchMedia("(prefers-reduced-motion: no-preference)");

function afterSettling(el: HTMLElement | null | undefined, run: () => void) {
  if (!el || !settles.matches) return run();
  const wait = () => {
    const moving = el.getAnimations().filter((a) => a.playState === "running");
    if (!moving.length) return run();
    void Promise.allSettled(moving.map((a) => a.finished)).then(run);
  };
  if (el.classList.contains("in")) return wait();
  const watch = new MutationObserver(() => {
    if (!el.classList.contains("in")) return;
    watch.disconnect();
    requestAnimationFrame(wait);
  });
  watch.observe(el, { attributes: true, attributeFilter: ["class"] });
}

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

const demoOrigin = (frame: HTMLIFrameElement) => new URL(frame.src, location.href).origin;

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
    frame.contentWindow?.postMessage({ type: "ardia-demo:customize" }, demoOrigin(frame));
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
    track("demo_setup_code_shown", { again: !first });
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
        if (root?.dataset.engaged === undefined) frame.contentWindow?.postMessage({ type: "ardia-demo:nudge" }, demoOrigin(frame));
      }, NUDGE_DELAY_MS);
    },
    { threshold: 0.6 },
  );
  seen.observe(box);
}

function restWhileFar(box: HTMLElement) {
  let top = 0;
  let bottom = 0;
  const update = () => {
    const margin = innerHeight * FAR_SCREENS;
    const far = bottom < scrollY - margin || top > scrollY + innerHeight + margin;
    if (far !== box.hasAttribute("data-far")) box.toggleAttribute("data-far", far);
  };
  const measure = () => {
    const rect = box.getBoundingClientRect();
    top = rect.top + scrollY;
    bottom = rect.bottom + scrollY;
    update();
  };
  addEventListener("scroll", update, { passive: true });
  addEventListener("resize", measure, { passive: true });
  new ResizeObserver(measure).observe(document.body);
}

function mount(box: HTMLElement, src: string) {
  const frame = document.createElement("iframe");
  frame.src = src;
  frame.title = "Ardia, live: try the sidebar, split view and the command bar";
  frame.allow = "clipboard-write";
  frame.className = "demo-frame";
  box.append(frame);
  fit(frame, box);
  new ResizeObserver(() => fit(frame, box)).observe(box);
  restWhileFar(box);

  const showCustomize = bar ? wireCustomize(frame, bar) : null;
  let ready = false;
  let loaded = false;
  let revealing = false;
  const reveal = () => {
    if (revealing) return;
    revealing = true;
    afterSettling(tilt, show);
  };
  const show = () => {
    if (!root || root.dataset.live === "") return;
    root.dataset.live = "";
    poster?.setAttribute("inert", "");
    if (bar) bar.hidden = false;
    document.querySelector("[data-band-lead]")?.replaceChildren("That was a demo. ");
    watchForNudge(frame, box);
  };
  frame.addEventListener("load", () => {
    loaded = true;
    if (ready) reveal();
  });
  addEventListener("message", (event: MessageEvent<Outbound>) => {
    if (event.source !== frame.contentWindow || event.origin !== demoOrigin(frame) || !event.data || typeof event.data !== "object") return;
    if (event.data.type === "ardia-demo:ready") {
      ready = true;
      if (loaded) reveal();
      else setTimeout(reveal, REVEAL_FALLBACK_MS);
    }
    if (event.data.type === "ardia-demo:engaged") root?.setAttribute("data-engaged", "");
    if (event.data.type === "ardia-demo:customize-state") showCustomize?.(event.data);
  });
}

function start() {
  if (!root || !stage || root.dataset.mounted === "") return;
  root.dataset.mounted = "";
  const src = root.dataset.demoSrc!;
  const near = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      near.disconnect();
      mount(stage, src);
    },
    { rootMargin: "100% 0px" },
  );
  near.observe(root);
}

function afterLoad(run: () => void) {
  const idle = () => ("requestIdleCallback" in window ? requestIdleCallback(run, { timeout: 2000 }) : setTimeout(run, 200));
  if (document.readyState === "complete") idle();
  else addEventListener("load", idle, { once: true });
}

afterLoad(start);
