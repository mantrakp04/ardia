#ifndef ARDIA_WIN_PAGE_LINKS_SCRIPT_H_
#define ARDIA_WIN_PAGE_LINKS_SCRIPT_H_

namespace ardia_win {

inline constexpr char kLinkScript[] = R"JS((() => {
  if (globalThis.ardiaPeek) return;
  const post = globalThis.ardiaPeekSend;
  const send = (kind, data) => {
    try {
      post(JSON.stringify({ kind, data }));
    } catch (e) {}
  };
  const guard = (fn) => (...args) => {
    try {
      return fn(...args);
    } catch (e) {}
  };
  const isTop = window === window.top;
  const pageIsWeb = /^https?:$/.test(location.protocol);
  const SVG = "http://www.w3.org/2000/svg";
  const XHTML = "http://www.w3.org/1999/xhtml";
  const PRESS_SLOP = 5;
  const MAX_SITE_PEEK_URL = 8192;
  let peekKey = null;
  let splitKey = null;
  let peekOtherSites = false;
  const linkUrl = (el) => {
    const name = el.localName;
    if (name !== "a" && name !== "area") return null;
    if (el.namespaceURI === SVG) {
      const raw = el.getAttribute("href") ?? el.getAttributeNS("http://www.w3.org/1999/xlink", "href");
      return raw === null ? "" : new URL(raw, el.baseURI).href;
    }
    if (!el.hasAttribute("href")) return "";
    return el.href;
  };
  const linkAt = (e) => {
    const path = e.composedPath();
    for (const node of path) {
      if (node === window || node === document || node.nodeType !== 1) continue;
      const url = linkUrl(node);
      if (url !== null) return { link: node, url, path };
    }
    return null;
  };
  const inEditable = (path) => {
    for (const node of path) {
      if (node === window || node === document || node.nodeType !== 1) continue;
      if (node.namespaceURI === XHTML) return node.isContentEditable;
    }
    return false;
  };
  const peekable = (hit) =>
    !!hit && !!hit.url && !hit.link.hasAttribute("download") && /^https?:/i.test(hit.url) && !inEditable(hit.path);
  const keyOf = (e) => {
    if (e.ctrlKey) return null;
    if (e.metaKey) return e.altKey && !e.shiftKey ? "altMeta" : null;
    if (e.altKey) return e.shiftKey ? "altShift" : "alt";
    return e.shiftKey ? "shift" : null;
  };
  const chosen = (e) => {
    const key = keyOf(e);
    if (!key) return null;
    if (key === peekKey) return key;
    if (!splitKey) return null;
    if (key === "altShift" || key === "altMeta") return key;
    return key === "alt" && splitKey === "alt" ? key : null;
  };
  const anyKey = () => !!(peekKey || splitKey || peekOtherSites);
  const plainPress = (e) => !e.altKey && !e.shiftKey && !e.metaKey && !e.ctrlKey;
  const siteKey = (e) => (peekOtherSites && isTop && pageIsWeb && plainPress(e) ? "site" : null);
  const withoutWww = (host) => (/^www\./i.test(host) ? host.slice(4) : host);
  const targetOf = (link) => {
    const own = link.getAttribute("target");
    if (own !== null) return own;
    const base = document.querySelector("base[target]");
    return base ? base.getAttribute("target") || "" : "";
  };
  const replacesPage = (link) => /^(_self|_top|_parent)?$/i.test(targetOf(link));
  const otherSite = (url) => withoutWww(new URL(url).hostname) !== withoutWww(location.hostname);
  const selecting = () => {
    const selection = document.getSelection();
    return !!selection && !selection.isCollapsed;
  };
  const carriesUrl = (url) => /[?&][^=&#]*=(https?(:|%3A)(\/\/|%2F%2F))/i.test(url);
  let press = null;
  let peeked = null;
  let siteClick = null;
  let sent = null;
  const refused = (refusal) => {
    const gesture = sent;
    if (!gesture || !refusal || !(refusal.download || refusal.follow) || refusal.url !== gesture.url || Date.now() - gesture.at > 60000) return;
    sent = null;
    if (refusal.follow) {
      if (gesture.link.namespaceURI === XHTML) return gesture.link.click();
      const follow = document.createElement("a");
      follow.setAttribute("href", gesture.url);
      follow.setAttribute("target", "_self");
      return follow.click();
    }
    const a = document.createElement("a");
    a.setAttribute("href", gesture.url);
    a.setAttribute("download", "");
    a.click();
  };
  addEventListener(
    "mousedown",
    guard((e) => {
      press = null;
      peeked = null;
      siteClick = null;
      if (!e.isTrusted || e.button !== 0) return;
      const hit = linkAt(e);
      if (!peekable(hit)) return;
      press = { link: hit.link, url: hit.url, x: e.clientX, y: e.clientY };
    }),
    true,
  );
  addEventListener(
    "mouseup",
    guard((e) => {
      const pressed = press;
      press = null;
      if (!pressed || !anyKey() || !e.isTrusted || e.button !== 0) return;
      const key = chosen(e) || siteKey(e);
      if (!key) return;
      const hit = linkAt(e);
      const moved = Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y);
      if (!hit || hit.link !== pressed.link || !peekable(hit) || moved > PRESS_SLOP) return;
      if (key === "site") {
        if (selecting()) return;
        siteClick = { link: hit.link, stamp: e.timeStamp };
        return;
      }
      peeked = { link: hit.link, stamp: e.timeStamp };
      sent = { url: hit.url, at: Date.now(), link: hit.link };
      const scale = window.devicePixelRatio;
      send("peek", { url: hit.url, key, origin: location.origin, x: e.clientX * scale, y: e.clientY * scale, moved });
    }),
    true,
  );
  addEventListener(
    "click",
    guard((e) => {
      const shown = peeked;
      if (!shown || !e.isTrusted || e.timeStamp !== shown.stamp || !e.composedPath().includes(shown.link)) return;
      peeked = null;
      e.preventDefault();
      e.stopImmediatePropagation();
    }),
    true,
  );
  const peekSiteLink = (e, link) => {
    if (e.defaultPrevented) return;
    const url = linkUrl(link);
    if (!peekable({ link, url, path: [] })) return;
    if (url.length > MAX_SITE_PEEK_URL) return;
    if (!otherSite(url) && !carriesUrl(url)) return;
    e.preventDefault();
    sent = { url, at: Date.now(), link };
    const scale = window.devicePixelRatio;
    send("peek", { url, key: "site", origin: location.origin, x: e.clientX * scale, y: e.clientY * scale, moved: 0 });
  };
  addEventListener(
    "click",
    guard((e) => {
      const site = siteClick;
      siteClick = null;
      if (!site || !e.isTrusted || e.button !== 0 || !plainPress(e)) return;
      if (e.timeStamp !== site.stamp || !e.composedPath().includes(site.link) || !replacesPage(site.link)) return;
      let decided = false;
      const decide = guard((ev) => {
        if (ev !== e || decided) return;
        decided = true;
        peekSiteLink(e, site.link);
      });
      window.addEventListener("click", decide);
      setTimeout(
        guard(() => {
          window.removeEventListener("click", decide);
          decided = true;
        }),
        0,
      );
    }),
    true,
  );
  globalThis.ardiaPeek = {
    config: guard((config) => {
      peekKey = config && (config.modifier === "alt" || config.modifier === "shift") ? config.modifier : null;
      splitKey = config && (config.split === "alt" || config.split === "altShift") ? config.split : null;
      peekOtherSites = !!(config && config.otherSites === true);
    }),
    refused: guard(refused),
  };
})();
)JS";

}

#endif
