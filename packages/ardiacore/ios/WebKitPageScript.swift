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
  const mediaEvents = ["play", "playing", "pause", "ended", "volumechange", "emptied", "loadedmetadata", "seeked", "ratechange"];
  const detached = new Set();
  const listened = new WeakSet();
  const heard = new WeakSet();
  let lastMedia = null;
  let lastHeard = null;
  let pageActions = [];
  let pagePosition = null;
  const allMedia = () => {
    const list = Array.from(document.querySelectorAll("video, audio"));
    for (const m of detached) if (!list.includes(m)) list.push(m);
    return list;
  };
  const playing = (m) => !m.paused && !m.ended;
  const audible = (m) => playing(m) && !m.muted && m.volume > 0;
  const applyMute = (m) => {
    if (muted && !m.muted) {
      m.muted = true;
      mutedByUs.add(m);
    }
  };
  const active = (list) => {
    const present = (m) => (m && list.includes(m) ? m : null);
    return list.find((m) => heard.has(m) && playing(m)) || present(lastHeard) || list.find(playing) || present(lastMedia);
  };
  const sessionState = () => (navigator.mediaSession ? navigator.mediaSession.playbackState : "none");
  const advancePosition = (state) => {
    const playingNow = state === "playing";
    if (playingNow === pagePosition.playing) return;
    const now = Date.now();
    if (pagePosition.playing) pagePosition.position += ((now - pagePosition.at) / 1000) * pagePosition.playbackRate;
    pagePosition.at = now;
    pagePosition.playing = playingNow;
  };
  const positionOf = (m, state) => {
    if (!pagePosition) return isFinite(m.currentTime) ? m.currentTime : 0;
    advancePosition(state);
    const { position, duration, playbackRate, at, playing } = pagePosition;
    const now = position + (playing ? ((Date.now() - at) / 1000) * playbackRate : 0);
    return Math.max(0, duration > 0 ? Math.min(now, duration) : now);
  };
  const movePagePosition = (m, state, to) => {
    if (!pagePosition) return;
    positionOf(m, state);
    pagePosition.position = Math.max(0, pagePosition.duration > 0 ? Math.min(to, pagePosition.duration) : to);
    pagePosition.at = Date.now();
  };
  let queued = false;
  const report = () => {
    queued = false;
    const list = allMedia();
    post("media", { playing: list.some(audible), muted });
    const m = active(list);
    const session = navigator.mediaSession;
    const fromSession = sessionState();
    if (!m || (m.paused && !m.currentTime && fromSession === "none")) return post("nowPlaying", null);
    const meta = session && session.metadata;
    const art = meta && meta.artwork && meta.artwork.length ? meta.artwork[meta.artwork.length - 1].src : null;
    const state = fromSession !== "none" ? fromSession : playing(m) ? "playing" : "paused";
    const duration = pagePosition && pagePosition.duration > 0 ? pagePosition.duration : m.duration;
    post("nowPlaying", {
      title: (meta && meta.title) || document.title || "",
      artist: (meta && meta.artist) || "",
      album: (meta && meta.album) || "",
      artwork: art,
      playbackState: state,
      position: positionOf(m, state),
      duration: isFinite(duration) ? duration : null,
      playbackRate: pagePosition ? pagePosition.playbackRate : m.playbackRate || 1,
      timestamp: Date.now(),
      hasVideo: m.tagName === "VIDEO" && m.videoWidth > 0,
      actions: pageActions,
      controllable: fromSession !== "none" || !(m.duration > 0 && m.duration <= 5),
    });
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    setTimeout(report, 100);
  };
  const listen = (m) => {
    if (listened.has(m)) return;
    listened.add(m);
    for (const type of mediaEvents) m.addEventListener(type, onMedia);
  };
  const track = (m) => {
    listen(m);
    if (detached.has(m)) return;
    if (detached.size >= 8) for (const old of detached) if (!playing(old)) {
      detached.delete(old);
      break;
    }
    detached.add(m);
  };
  const onMedia = (e) => {
    const m = e.target;
    if (!(m instanceof HTMLMediaElement)) return;
    if (!m.isConnected) track(m);
    lastMedia = m;
    if (e.type === "play" || e.type === "playing") {
      applyMute(m);
      listen(m);
    }
    if (e.type === "volumechange") applyMute(m);
    if (audible(m)) {
      heard.add(m);
      lastHeard = m;
    }
    schedule();
  };
  for (const type of mediaEvents) document.addEventListener(type, onMedia, true);
  document.addEventListener(
    "ardia:media-element",
    (e) => {
      const m = e.relatedTarget;
      if (!(m instanceof HTMLMediaElement)) return;
      track(m);
      schedule();
    },
    true,
  );
  const knownActions = ["play", "pause", "stop", "seekbackward", "seekforward", "seekto", "previoustrack", "nexttrack", "skipad", "enterpictureinpicture"];
  document.addEventListener(
    "ardia:media-session",
    (e) => {
      let data = null;
      try {
        data = typeof e.detail === "string" ? JSON.parse(e.detail) : null;
      } catch (error) {}
      if (!data || typeof data !== "object") return;
      pageActions = Array.isArray(data.actions) ? knownActions.filter((a) => data.actions.includes(a)) : [];
      const p = data.position;
      const finite = (n) => typeof n === "number" && isFinite(n);
      if (!p || !finite(p.position) || !finite(p.duration)) pagePosition = null;
      else {
        const sample = finite(p.id) ? p.id : null;
        if (!pagePosition || sample === null || pagePosition.sample !== sample)
          pagePosition = {
            position: Math.max(0, p.position),
            duration: p.duration,
            playbackRate: finite(p.playbackRate) && p.playbackRate ? p.playbackRate : 1,
            at: finite(p.at) ? p.at : Date.now(),
            sample,
            playing: p.playing === true,
          };
      }
      schedule();
    },
    true,
  );
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
    const scrollDirection = () => {
      const DOWN = 24, UP = 12, MIN_RANGE = 120, SETTLE = 300, GESTURE = 300;
      let anchor = 0, last = 0, lastAt = -1e9, settleUntil = -1e9, budget = 0, height = 0, sent = null, gestureSent = false;
      const resized = (viewport, now) => {
        if (now >= settleUntil) budget = 0;
        if (height && viewport !== height) {
          settleUntil = now + SETTLE;
          budget += Math.abs(viewport - height) + 2;
        }
        height = viewport;
      };
      return {
        resized,
        rebase(y) {
          anchor = last = y;
        },
        scrolled(y, range, viewport, now, user) {
          resized(viewport, now);
          if (now - lastAt > GESTURE) {
            gestureSent = false;
            anchor = last;
          }
          lastAt = now;
          const moved = y - last;
          last = y;
          if (budget > 0 && moved) {
            const absorbed = Math.min(budget, Math.abs(moved));
            budget -= absorbed;
            anchor += moved > 0 ? absorbed : -absorbed;
          }
          let state = null;
          if (y <= 2) state = "top";
          else if (!user) anchor = y;
          else if (y - anchor >= DOWN) {
            if (range >= MIN_RANGE) state = "down";
            else anchor = y;
          } else if (anchor - y >= UP) state = "up";
          else if (sent === "down" ? gestureSent && y > anchor : y < anchor) anchor = y;
          if (state) anchor = y;
          if (!state || (state === sent && (state !== "down" || gestureSent))) return null;
          sent = state;
          if (state === "down") gestureSent = true;
          return state;
        },
      };
    };
    const direction = scrollDirection();
    let scroller = null;
    let scrollTarget = null;
    let inputAt = -1e9;
    const noteInput = () => {
      inputAt = performance.now();
      if (!scroller && document.scrollingElement) direction.rebase((scroller = document.scrollingElement).scrollTop);
    };
    for (const type of ["wheel", "keydown", "mousedown", "touchstart"]) addEventListener(type, noteInput, { passive: true, capture: true });
    addEventListener("mousemove", (e) => e.buttons && noteInput(), { passive: true, capture: true });
    const measureScroll = () => {
      try {
        const target = scrollTarget;
        scrollTarget = null;
        const doc = document.scrollingElement || document.documentElement;
        const el = target === document || target === doc ? doc : target;
        if (!el || !doc || (el !== doc && (el.clientHeight < innerHeight * 0.5 || el.clientWidth < innerWidth * 0.5))) return;
        if (el !== scroller) direction.rebase((scroller = el).scrollTop);
        const now = performance.now();
        const state = direction.scrolled(el.scrollTop, el.scrollHeight - el.clientHeight, innerHeight, now, now - inputAt < 1000);
        if (state) post("scroll", { state });
      } catch (e) {}
    };
    addEventListener(
      "scroll",
      (e) => {
        if (!scrollTarget) requestAnimationFrame(measureScroll);
        scrollTarget = e.target;
      },
      { passive: true, capture: true },
    );
    addEventListener("resize", () => direction.resized(innerHeight, performance.now()));
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
      const m = active(allMedia());
      const call = (name, details) =>
        pageActions.includes(name) &&
        !document.dispatchEvent(new CustomEvent("ardia:media-action", { cancelable: true, detail: JSON.stringify({ action: name, ...details }) }));
      const isPlaying = sessionState() === "playing" || (!!m && playing(m));
      if (action === "play") call("play") || (m && m.play());
      else if (action === "pause") call("pause") || (m && m.pause());
      else if (action === "stop") call("stop") || (m && m.pause());
      else if (action === "toggle") isPlaying ? call("pause") || (m && m.pause()) : call("play") || (m && m.play());
      else if (action === "next") call("nexttrack");
      else if (action === "previous") call("previoustrack");
      else if (action === "seekBy") {
        const handled = seconds >= 0 ? call("seekforward", { seekOffset: seconds }) : call("seekbackward", { seekOffset: -seconds });
        if (!handled && m) {
          const state = isPlaying ? "playing" : "paused";
          const from = pagePosition ? positionOf(m, state) : m.currentTime;
          m.currentTime = Math.max(0, Math.min(m.duration || Infinity, m.currentTime + seconds));
          movePagePosition(m, state, from + seconds);
        }
      } else if (action === "seekTo" && !call("seekto", { seekTime: seconds }) && m) {
        m.currentTime = Math.max(0, seconds);
        movePagePosition(m, isPlaying ? "playing" : "paused", seconds);
      }
      schedule();
      return !!m || pageActions.length > 0;
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

  static let mediaBridge = #"""
(() => {
  const apply = Reflect.apply;
  const dispatch = EventTarget.prototype.dispatchEvent;
  const listen = EventTarget.prototype.addEventListener;
  const preventDefault = Event.prototype.preventDefault;
  const detailOf = Object.getOwnPropertyDescriptor(CustomEvent.prototype, "detail").get;
  const connected = Object.getOwnPropertyDescriptor(Node.prototype, "isConnected").get;
  const { stringify, parse } = JSON;
  const Custom = CustomEvent;
  const Mouse = MouseEvent;
  const now = Date.now;
  const doc = document;
  const handedOver = new WeakSet();
  const mediaProto = HTMLMediaElement.prototype;
  const play = mediaProto.play;
  mediaProto.play = function () {
    if (!handedOver.has(this) && !apply(connected, this, [])) {
      handedOver.add(this);
      try {
        apply(dispatch, doc, [new Mouse("ardia:media-element", { relatedTarget: this })]);
      } catch (e) {}
    }
    return apply(play, this, arguments);
  };

  const session = navigator.mediaSession;
  const proto = session && Object.getPrototypeOf(session);
  if (!proto) return;
  const handlers = new Map();
  let position = null;
  let samples = 0;
  const notify = () => {
    try {
      apply(dispatch, doc, [new Custom("ardia:media-session", { detail: stringify({ actions: Array.from(handlers.keys()), position }) })]);
    } catch (e) {}
  };
  const setActionHandler = proto.setActionHandler;
  if (typeof setActionHandler === "function") {
    proto.setActionHandler = function (action, handler) {
      const result = apply(setActionHandler, this, arguments);
      if (typeof handler === "function") handlers.set(String(action), handler);
      else handlers.delete(String(action));
      notify();
      return result;
    };
  }
  const setPositionState = proto.setPositionState;
  if (typeof setPositionState === "function") {
    proto.setPositionState = function (state) {
      const result = apply(setPositionState, this, arguments);
      position =
        state && typeof state === "object"
          ? { duration: +state.duration, position: +(state.position || 0), playbackRate: +(state.playbackRate || 1), at: now(), id: ++samples, playing: this.playbackState === "playing" }
          : null;
      notify();
      return result;
    };
  }
  for (const name of ["metadata", "playbackState"]) {
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (!d || !d.set) continue;
    Object.defineProperty(proto, name, {
      ...d,
      set(value) {
        apply(d.set, this, [value]);
        notify();
      },
    });
  }
  apply(listen, doc, [
    "ardia:media-action",
    (e) => {
      let request = null;
      try {
        request = parse(apply(detailOf, e, []));
      } catch (error) {}
      const handler = request && typeof request.action === "string" ? handlers.get(request.action) : null;
      if (typeof handler !== "function") return;
      apply(preventDefault, e, []);
      const details = { action: request.action };
      if (typeof request.seekOffset === "number") details.seekOffset = request.seekOffset;
      if (typeof request.seekTime === "number") details.seekTime = request.seekTime;
      try {
        handler(details);
      } catch (error) {}
    },
    true,
  ]);
})();
"""#
}
