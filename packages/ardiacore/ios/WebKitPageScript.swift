enum WebKitPageScript {
  static let source = #"""
(() => {
  if (window.__ardia) return;
  const isTop = window === window.top;
  const frame = Math.random().toString(36).slice(2);
  const post = (kind, data) => {
    try {
      window.webkit.messageHandlers.ardia.postMessage({ kind, data: data === undefined ? null : data, frame });
    } catch (e) {}
  };
  let muted = false;
  const mutedByUs = new WeakSet();
  let lastMedia = null;
  const allMedia = () => Array.from(document.querySelectorAll("video, audio"));
  const audible = (m) => !m.paused && !m.ended && !m.muted && m.volume > 0;
  const applyMute = (m) => {
    if (muted && !m.muted) {
      m.muted = true;
      mutedByUs.add(m);
    }
  };
  const active = () => {
    const list = allMedia();
    return list.find((m) => !m.paused && !m.ended) || (lastMedia && lastMedia.isConnected ? lastMedia : null);
  };
  let queued = false;
  const report = () => {
    queued = false;
    const list = allMedia();
    post("media", { playing: list.some(audible), muted });
    const m = active();
    if (!m || (m.paused && !m.currentTime)) return post("nowPlaying", null);
    const session = navigator.mediaSession;
    const meta = session && session.metadata;
    const art = meta && meta.artwork && meta.artwork.length ? meta.artwork[meta.artwork.length - 1].src : null;
    post("nowPlaying", {
      title: (meta && meta.title) || document.title || "",
      artist: (meta && meta.artist) || "",
      album: (meta && meta.album) || "",
      artwork: art,
      playbackState: m.paused ? "paused" : "playing",
      position: isFinite(m.currentTime) ? m.currentTime : 0,
      duration: isFinite(m.duration) ? m.duration : null,
      playbackRate: m.playbackRate || 1,
      timestamp: Date.now(),
      hasVideo: m.tagName === "VIDEO" && m.videoWidth > 0,
      actions: ["play", "pause", "seekBy", "seekTo"],
      controllable: true,
    });
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    setTimeout(report, 100);
  };
  for (const type of ["play", "playing", "pause", "ended", "volumechange", "emptied", "loadedmetadata", "seeked", "ratechange"]) {
    document.addEventListener(
      type,
      (e) => {
        const m = e.target;
        if (!(m instanceof HTMLMediaElement)) return;
        lastMedia = m;
        if (type === "play" || type === "playing") applyMute(m);
        schedule();
      },
      true,
    );
  }
  const pip = (on) => post("pip", { active: on });
  document.addEventListener("enterpictureinpicture", () => pip(true), true);
  document.addEventListener("leavepictureinpicture", () => pip(false), true);
  document.addEventListener(
    "webkitpresentationmodechanged",
    (e) => e.target instanceof HTMLVideoElement && pip(e.target.webkitPresentationMode === "picture-in-picture"),
    true,
  );

  let hovered = "";
  document.addEventListener(
    "mouseover",
    (e) => {
      const link = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      const href = link ? link.href : "";
      if (href === hovered) return;
      hovered = href;
      post("status", href);
    },
    true,
  );
  document.addEventListener("mouseleave", () => hovered && post("status", (hovered = "")), true);

  const sendIcons = () => {
    if (!isTop) return;
    const links = Array.from(document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"], link[rel~="apple-touch-icon"]'));
    const urls = links.map((l) => l.href).filter((h) => /^(https?|data):/.test(h));
    if (!urls.length && /^https?:$/.test(location.protocol)) urls.push(location.origin + "/favicon.ico");
    if (urls.length) post("icons", { urls });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", sendIcons, { once: true });
  else sendIcons();
  addEventListener("load", sendIcons, { once: true });

  if (isTop) {
    let anchor = 0;
    let sent = null;
    let inputAt = -1e9;
    const noteInput = () => (inputAt = performance.now());
    for (const type of ["wheel", "keydown", "mousedown"]) addEventListener(type, noteInput, { passive: true, capture: true });
    addEventListener(
      "scroll",
      () => {
        const y = window.scrollY;
        let state = null;
        if (y <= 2) state = "top";
        else if (performance.now() - inputAt > 1000) anchor = y;
        else if (y - anchor >= 24 && document.documentElement.scrollHeight - innerHeight >= 120) state = "down";
        else if (anchor - y >= 12) state = "up";
        if (state) anchor = y;
        if (!state || state === sent) return;
        sent = state;
        post("scroll", { state });
      },
      { passive: true },
    );
  }

  window.__ardia = {
    mute(on) {
      muted = !!on;
      for (const m of allMedia()) {
        if (muted) applyMute(m);
        else if (mutedByUs.has(m)) {
          m.muted = false;
          mutedByUs.delete(m);
        }
      }
      report();
    },
    media(action, seconds) {
      const m = active();
      if (!m) return false;
      if (action === "play") m.play();
      else if (action === "pause" || action === "stop") m.pause();
      else if (action === "toggle") m.paused ? m.play() : m.pause();
      else if (action === "seekBy") m.currentTime = Math.max(0, m.currentTime + seconds);
      else if (action === "seekTo") m.currentTime = Math.max(0, seconds);
      return true;
    },
    pictureInPicture(on) {
      if (!on) {
        if (document.pictureInPictureElement) document.exitPictureInPicture();
        for (const v of document.querySelectorAll("video")) if (v.webkitPresentationMode === "picture-in-picture") v.webkitSetPresentationMode("inline");
        return true;
      }
      const videos = Array.from(document.querySelectorAll("video"));
      const v = videos.find((x) => !x.paused) || videos.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
      if (!v) return false;
      if (v.webkitSupportsPresentationMode && v.webkitSupportsPresentationMode("picture-in-picture")) v.webkitSetPresentationMode("picture-in-picture");
      else if (v.requestPictureInPicture) v.requestPictureInPicture();
      else return false;
      return true;
    },
    count(text) {
      if (!text || !document.body) return 0;
      const haystack = document.body.innerText.toLowerCase();
      const needle = text.toLowerCase();
      let n = 0;
      for (let at = haystack.indexOf(needle); at >= 0 && n < 1000; at = haystack.indexOf(needle, at + needle.length)) n++;
      return n;
    },
  };
})();
"""#
}
