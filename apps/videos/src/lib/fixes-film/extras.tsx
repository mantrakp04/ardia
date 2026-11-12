import type { CSSProperties } from "react";
import { AbsoluteFill, Easing, Freeze, Img, interpolate, OffthreadVideo, Sequence, staticFile } from "remotion";
import { color } from "../ac-launch/theme";
import { clamp, FPS, HOLD_IN, label, shownBetween } from "./look";
import type { Banner, Cam, Clip, Dialog, Menu, MenuGeometry, MenuItem, Note, Overlay, PageGone, Pointer, WindowGone } from "./types";

const OVERLAY_RADIUS = 12;

const ALERT = {
  w: 260,
  radius: 26,
  pad: 20,
  icon: 64,
  title: 13,
  body: 11,
  button: 28,
  gap: 8,
};

export function AlertReplica({ dialog, t, cam, k }: { dialog: Dialog; t: number; cam: Cam; k: number }) {
  const opacity = shownBetween(t, dialog.t, dialog.until);
  if (opacity <= 0) return null;
  const rise = interpolate(t, [dialog.t, dialog.t + 0.22], [0.94, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const pressed = t >= dialog.press && t < dialog.press + 0.12;
  const button = (primary: boolean): CSSProperties => ({
    height: ALERT.button * k,
    borderRadius: (ALERT.button / 2) * k,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: ALERT.title * k,
    fontWeight: primary ? 600 : 500,
    color: primary ? "#FFFFFF" : "rgba(0,0,0,0.85)",
    background: primary ? (pressed ? "#0062D6" : "#0A84FF") : "rgba(0,0,0,0.07)",
  });
  return (
    <div
      style={{
        position: "absolute",
        left: (dialog.x - cam[0] - ALERT.w / 2) * k,
        top: (dialog.y - cam[1]) * k,
        width: ALERT.w * k,
        boxSizing: "border-box",
        padding: ALERT.pad * k,
        borderRadius: ALERT.radius * k,
        opacity,
        transform: `scale(${rise})`,
        transformOrigin: "50% 0%",
        background: "rgba(246, 244, 245, 0.97)",
        boxShadow: `0 ${14 * k}px ${44 * k}px rgba(0,0,0,0.28), 0 0 0 ${0.5 * k}px rgba(0,0,0,0.16)`,
        fontFamily: '-apple-system, "SF Pro Text", system-ui, sans-serif',
        color: "rgba(0,0,0,0.85)",
        textAlign: "center",
      }}
    >
      {dialog.icon === false ? null : <Img src={staticFile("brand/app-icon.png")} style={{ width: ALERT.icon * k, height: ALERT.icon * k, display: "block", margin: `0 auto ${10 * k}px` }} />}
      <div style={{ fontSize: ALERT.title * k, fontWeight: 700, lineHeight: 1.3 }}>{dialog.title}</div>
      <div style={{ marginTop: 6 * k, fontSize: ALERT.body * k, lineHeight: 1.35, color: "rgba(0,0,0,0.7)" }}>{dialog.message}</div>
      {dialog.suppression ? (
        <div style={{ marginTop: 12 * k, display: "flex", alignItems: "center", gap: 6 * k, fontSize: ALERT.body * k, textAlign: "left" }}>
          <div style={{ width: 14 * k, height: 14 * k, borderRadius: 4 * k, background: "#FFFFFF", boxShadow: `inset 0 0 0 ${0.75 * k}px rgba(0,0,0,0.3)` }} />
          {dialog.suppression}
        </div>
      ) : null}
      <div style={{ marginTop: 14 * k, display: "flex", flexDirection: "column", gap: ALERT.gap * k }}>
        <div style={button(true)}>{dialog.confirmTitle}</div>
        <div style={button(false)}>{dialog.cancelTitle}</div>
      </div>
    </div>
  );
}

export function PageGoneCover({ gone, t }: { gone: PageGone; t: number }) {
  const opacity = interpolate(t, [gone.t, gone.t + 0.04], [0, 1], clamp);
  if (opacity <= 0) return null;
  return (
    <AbsoluteFill style={{ opacity, background: color.paperDeep, alignItems: "center", justifyContent: "center" }}>
      <div style={{ ...label, fontSize: 22, fontWeight: 620, color: color.paper, background: color.ink, padding: "10px 16px 9px", borderRadius: 10 }}>{gone.text}</div>
    </AbsoluteFill>
  );
}

export function NoteBubble({ note, t, cam, k }: { note: Note; t: number; cam: Cam; k: number }) {
  const opacity = shownBetween(t, note.t, note.until);
  if (opacity <= 0) return null;
  return (
    <div
      style={{
        ...label,
        position: "absolute",
        left: (note.x - cam[0]) * k + 30,
        top: (note.y - cam[1]) * k + 12,
        opacity,
        fontSize: 22,
        fontWeight: 620,
        color: color.paper,
        background: color.ink,
        padding: "8px 14px 7px",
        borderRadius: 10,
        whiteSpace: "nowrap",
      }}
    >
      {note.text}
    </div>
  );
}

export function OverlayWindow({ overlay, clip, cam, k, play, rate }: { overlay: Overlay; clip: Clip; cam: Cam; k: number; play: number; rate: number }) {
  const from = HOLD_IN + Math.round((Math.max(0, overlay.t - clip.inS) / rate) * FPS);
  const end = overlay.until === undefined ? HOLD_IN + play : Math.min(HOLD_IN + play, HOLD_IN + Math.round((Math.max(0, overlay.until - clip.inS) / rate) * FPS));
  const shown = end - from;
  if (shown <= 0) return null;
  const video = <OffthreadVideo src={staticFile(overlay.file)} trimBefore={Math.round(Math.max(0, clip.inS - overlay.t) * FPS)} muted playbackRate={rate} style={{ width: "100%", height: "100%" }} />;
  const frame: CSSProperties = {
    position: "absolute",
    left: (overlay.x - cam[0]) * k,
    top: (overlay.y - cam[1]) * k,
    width: overlay.w * k,
    height: overlay.h * k,
    borderRadius: OVERLAY_RADIUS * k,
    overflow: "hidden",
    boxShadow: `0 ${18 * k}px ${40 * k}px rgba(0,0,0,0.28), 0 0 0 ${k}px rgba(0,0,0,0.12)`,
  };
  return (
    <>
      <Sequence from={from} durationInFrames={shown} layout="none">
        <div style={frame}>{video}</div>
      </Sequence>
      {overlay.until === undefined ? (
        <Sequence from={from + shown} layout="none">
          <div style={frame}>
            <Freeze frame={shown - 1}>{video}</Freeze>
          </div>
        </Sequence>
      ) : null}
    </>
  );
}

const BANNER = { w: 400, radius: 24, pad: 14, icon: 40, margin: 18 };

export function NotificationBanner({ banner, t }: { banner: Banner; t: number }) {
  if (t < banner.t) return null;
  const k = interpolate(t, [banner.t, banner.t + 0.38], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const chip = interpolate(t, [banner.t + 0.45, banner.t + 0.7], [0, 1], clamp);
  return (
    <div style={{ position: "absolute", right: BANNER.margin, top: BANNER.margin, width: BANNER.w, opacity: k, transform: `translateX(${(1 - k) * 60}px)` }}>
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
          padding: BANNER.pad,
          borderRadius: BANNER.radius,
          background: "rgb(246, 244, 245)",
          boxShadow: "0 16px 44px rgba(0,0,0,0.28), 0 0 0 0.5px rgba(0,0,0,0.16)",
          fontFamily: '-apple-system, "SF Pro Text", system-ui, sans-serif',
          color: "rgba(0,0,0,0.85)",
        }}
      >
        <Img src={staticFile("brand/app-icon.png")} style={{ width: BANNER.icon, height: BANNER.icon, flex: "none" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 700, lineHeight: 1.3 }}>
            <span>{banner.title}</span>
            <span style={{ fontSize: 13, fontWeight: 400, color: "rgba(0,0,0,0.45)" }}>now</span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>{banner.subtitle}</div>
          <div style={{ fontSize: 14, lineHeight: 1.35, color: "rgba(0,0,0,0.75)" }}>{banner.body}</div>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12, opacity: chip }}>
        <div
          style={{
            ...label,
            fontSize: 21,
            fontWeight: 620,
            color: color.paper,
            background: banner.silent ? color.blue : color.ink,
            padding: "8px 14px 7px",
            borderRadius: 10,
          }}
        >
          {banner.silent ? "No sound" : "Plays the alert sound"}
        </div>
      </div>
    </div>
  );
}

const MENU_LOOK = {
  radius: 12,
  font: 13,
  gutter: 20,
  icon: 16,
  iconGap: 6,
  highlightInset: 5,
  highlightRadius: 6,
  background: "rgba(44, 43, 46, 0.97)",
  text: "rgba(255, 255, 255, 0.88)",
  highlight: "#0A64D8",
};

function rowsOf(items: MenuItem[], top: number, g: MenuGeometry) {
  let y = top + g.pad;
  return items.map((item) => {
    const h = item.separator ? g.separator : g.row;
    const row = { item, y, h };
    y += h;
    return row;
  });
}

function heightOf(items: MenuItem[], g: MenuGeometry) {
  return g.pad * 2 + items.reduce((sum, i) => sum + (i.separator ? g.separator : g.row), 0);
}

function inside(p: Pointer, x: number, y: number, w: number, h: number) {
  return !!p && p.x >= x && p.x < x + w && p.y >= y && p.y < y + h;
}

function MenuColumn({ items, x, y, width, g, hot, cam, k, symbols }: { items: MenuItem[]; x: number; y: number; width: number; g: MenuGeometry; hot: MenuItem | null; cam: Cam; k: number; symbols: string }) {
  const rows = rowsOf(items, y, g);
  return (
    <div
      style={{
        position: "absolute",
        left: (x - cam[0]) * k,
        top: (y - cam[1]) * k,
        width: width * k,
        height: heightOf(items, g) * k,
        borderRadius: MENU_LOOK.radius * k,
        background: MENU_LOOK.background,
        boxShadow: `0 ${10 * k}px ${30 * k}px rgba(0,0,0,0.45), 0 0 0 ${0.5 * k}px rgba(255,255,255,0.16)`,
        fontFamily: '-apple-system, "SF Pro Text", system-ui, sans-serif',
        fontSize: MENU_LOOK.font * k,
        color: MENU_LOOK.text,
      }}
    >
      {rows.map(({ item, y: ry, h }, i) =>
        item.separator ? (
          <div key={i} style={{ position: "absolute", left: 10 * k, right: 10 * k, top: (ry - y + h / 2) * k, height: Math.max(1, 0.5 * k), background: "rgba(255,255,255,0.14)" }} />
        ) : (
          <div
            key={i}
            style={{
              position: "absolute",
              left: MENU_LOOK.highlightInset * k,
              right: MENU_LOOK.highlightInset * k,
              top: (ry - y) * k,
              height: h * k,
              borderRadius: MENU_LOOK.highlightRadius * k,
              background: hot === item ? MENU_LOOK.highlight : "transparent",
              color: hot === item ? "#FFFFFF" : MENU_LOOK.text,
              display: "flex",
              alignItems: "center",
            }}
          >
            <div style={{ width: (MENU_LOOK.gutter - MENU_LOOK.highlightInset) * k, textAlign: "center", fontSize: 11 * k, fontWeight: 600 }}>{item.checked ? "✓" : ""}</div>
            {item.symbol ? <Img src={staticFile(`${symbols}/${item.symbol}.png`)} style={{ width: MENU_LOOK.icon * k, height: MENU_LOOK.icon * k, marginRight: MENU_LOOK.iconGap * k }} /> : null}
            <div style={{ flex: 1, whiteSpace: "nowrap" }}>{item.title}</div>
            {item.children ? <div style={{ paddingRight: 8 * k, fontSize: 12 * k, opacity: 0.7 }}>›</div> : null}
          </div>
        ),
      )}
    </div>
  );
}

export function MenuReplica({ menu, t, p, cam, k, symbols }: { menu: Menu; t: number; p: Pointer; cam: Cam; k: number; symbols: string }) {
  if (t < menu.t || t > menu.until + 0.2) return null;
  const g = menu.geometry;
  const opacity = interpolate(t, [menu.t, menu.t + 0.05, menu.until + 0.05, menu.until + 0.2], [0, 1, 1, 0], clamp);
  const parent = menu.items.find((i) => i.children) ?? null;
  const children = parent?.children ?? [];
  const subOpen = menu.sub !== null && t >= menu.sub;
  const hotIn = (items: MenuItem[], x: number, top: number, width: number) =>
    rowsOf(items, top, g).find(({ item, y, h }) => !item.separator && inside(p, x, y, width, h))?.item ?? null;
  const subHot = subOpen ? hotIn(children, g.subX, g.subY, g.subWidth) : null;
  const mainHot = subOpen ? parent : hotIn(menu.items, g.x, g.y, g.width);
  return (
    <div style={{ position: "absolute", inset: 0, opacity }}>
      <MenuColumn items={menu.items} x={g.x} y={g.y} width={g.width} g={g} hot={mainHot} cam={cam} k={k} symbols={symbols} />
      {subOpen ? <MenuColumn items={children} x={g.subX} y={g.subY} width={g.subWidth} g={g} hot={subHot} cam={cam} k={k} symbols={symbols} /> : null}
      <div style={{ ...label, position: "absolute", right: 14, top: 14, fontSize: 18, fontWeight: 620, color: color.paper, background: color.ink, padding: "7px 12px 6px", borderRadius: 9 }}>Menu drawn from Ardia's log</div>
    </div>
  );
}

const DOCK_LEAD = 0.9;

export function WindowGoneCover({ gone, t }: { gone: WindowGone; t: number }) {
  const opacity = shownBetween(t, gone.t, gone.until);
  if (opacity <= 0) return null;
  const asking = interpolate(t, [gone.reopen - DOCK_LEAD, gone.reopen - DOCK_LEAD + 0.2], [0, 1], clamp);
  const glide = interpolate(t, [gone.reopen - DOCK_LEAD, gone.reopen - 0.1], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const pressed = t >= gone.reopen - 0.08 && t < gone.reopen + 0.06;
  const bounce = interpolate(t, [gone.reopen, gone.reopen + 0.18, gone.reopen + 0.36], [0, -14, 0], clamp);
  return (
    <AbsoluteFill style={{ opacity, background: color.paperDeep, alignItems: "center", justifyContent: "center" }}>
      <div style={{ ...label, fontSize: 22, fontWeight: 620, color: color.ink2 }}>No window open</div>
      <div style={{ position: "relative", marginTop: 34, width: 150, height: 150 }}>
        <Img src={staticFile("brand/app-icon.png")} style={{ width: 150, height: 150, transform: `translateY(${bounce}px)` }} />
        <Img
          src={staticFile("brand/cursor-arrow.png")}
          style={{
            position: "absolute",
            left: 96 + (1 - glide) * 150,
            top: 92 + (1 - glide) * 70,
            width: 39,
            height: 56,
            opacity: asking,
            transform: `scale(${pressed ? 0.86 : 1})`,
            transformOrigin: "16% 10%",
          }}
        />
      </div>
      <div
        style={{
          ...label,
          marginTop: 30,
          fontSize: 22,
          fontWeight: 620,
          color: color.paper,
          background: color.ink,
          padding: "10px 16px 9px",
          borderRadius: 10,
          opacity: asking,
        }}
      >
        Click the Dock icon
      </div>
    </AbsoluteFill>
  );
}
