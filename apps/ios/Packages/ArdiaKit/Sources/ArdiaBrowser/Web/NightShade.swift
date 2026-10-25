import Foundation

enum PageScripts {
  static let handlerName = "ardiaPage"

  static let nightShade = #"""
  (() => {
    if (window.__ardiaNightShade) return;
    const STYLE_ID = "ardia-night-shade";
    const CSS = "html{filter:invert(1) hue-rotate(180deg)!important;background-color:#fff!important}" +
      "img,video,canvas,picture,iframe,embed,object,svg image,[style*=\"background-image\"]{filter:invert(1) hue-rotate(180deg)!important}" +
      "picture img{filter:none!important}";
    let mode = "disabled";
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");

    const luminance = (color) => {
      const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(color || "");
      if (!m) return null;
      if (m[4] !== undefined && Number(m[4]) < 0.1) return null;
      const [r, g, b] = [m[1], m[2], m[3]].map((v) => {
        const c = Number(v) / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const pageIsLight = () => {
      const root = document.documentElement;
      if (!root) return false;
      const scheme = getComputedStyle(root).colorScheme || "";
      if (/dark/.test(scheme) && (!/light/.test(scheme) || prefersDark.matches)) return false;
      for (const el of [document.body, root]) {
        if (!el) continue;
        const value = luminance(getComputedStyle(el).backgroundColor);
        if (value !== null) return value > 0.45;
      }
      return true;
    };
    const setStyle = (on) => {
      let style = document.getElementById(STYLE_ID);
      if (on && !style) {
        style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = CSS;
        (document.head || document.documentElement).appendChild(style);
      } else if (!on && style) {
        style.remove();
      }
    };
    const evaluate = () => {
      const wanted = mode === "always" || (mode === "automatic" && prefersDark.matches);
      if (!wanted) return setStyle(false);
      setStyle(false);
      setStyle(pageIsLight());
    };
    window.__ardiaNightShade = (next) => { mode = next; evaluate(); };
    prefersDark.addEventListener("change", evaluate);
    const ask = async () => {
      try { mode = await window.webkit.messageHandlers.ardiaPage.postMessage({ type: "nightShade" }) || "disabled"; } catch (e) { mode = "disabled"; }
      evaluate();
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ask, { once: true });
    else ask();
  })();
  """#
}
