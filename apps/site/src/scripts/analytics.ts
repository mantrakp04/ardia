import { capture, type Props } from "./telemetry";
import { KEYS, firstThisSession } from "./storage";
import { SENT_REFS } from "../data/release";
import type { SiteEvent } from "../data/telemetry";

const root = document.documentElement;

function onTrackedClick(e: MouseEvent) {
  const el = (e.target as Element | null)?.closest<HTMLElement>("[data-track]");
  if (!el) return;
  if (root.dataset.device === "phone" && el.hasAttribute("data-download")) return;
  const props: Props = {};
  for (const [k, v] of Object.entries(el.dataset)) {
    if (k.startsWith("track") && k !== "track" && v !== undefined) {
      const name = k.slice(5).replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`).replace(/^_/, "");
      props[name] = v;
    }
  }
  const leaves = el instanceof HTMLAnchorElement && el.origin !== location.origin && !el.hasAttribute("download");
  capture(el.dataset.track as SiteEvent, props, leaves ? { send_instantly: true } : undefined);
}
document.addEventListener("click", onTrackedClick, { capture: true });

const sections = document.querySelectorAll<HTMLElement>("[data-shot]");
if (sections.length) {
  const seen = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        seen.unobserve(e.target);
        capture("section_viewed", { section: (e.target as HTMLElement).dataset.shot ?? null });
      }
    },
    { threshold: 0.35 },
  );
  for (const s of sections) seen.observe(s);
}

const sentRef = SENT_REFS.find((ref) => ref === new URLSearchParams(location.search).get("ref"));
if (sentRef && firstThisSession(KEYS.macLinkVisit)) capture("mac_link_visit", { ref: sentRef, device: root.dataset.device ?? null });

const { device, os } = root.dataset;
if (device === "other" && firstThisSession(KEYS.nonMacVisit)) capture("non_mac_visit", { os: os ?? null });
