import { create } from "zustand";
import { hostSupports, invokeHost, reportHostError, type ArdiaHost } from "./host.ts";
import { parseFrame, type PlayerFrame, type Rect } from "./pipGeometry.ts";

export const PIP_ATTACH = "pip.attach";
export const PIP_VIEWPORT = "pip.viewport";
export const PIP_COMMAND = "pip.command";
export const PIP_FRAME_DOCUMENT = "pip-player.json";

export type PlayerPosition = { current: number; duration: number | null; rate: number; at: number };
export type PlayerState = {
  player: number;
  tab: number;
  playing: boolean;
  ended: boolean;
  playPause: boolean;
  origin: string;
  natural: { width: number; height: number };
  position: PlayerPosition | null;
};
export type PlayerLeaving = { player: number; fade: number };

export const usePipPlayer = create<{ state: PlayerState | null; leaving: PlayerLeaving | null; frame: PlayerFrame | null }>(() => ({ state: null, leaving: null, frame: null }));

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function readPlayerEvent(payload: unknown, now: number): { state: PlayerState } | { leaving: PlayerLeaving } | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  if (!finite(data.player) || data.player <= 0) return null;
  if (data.active === false) return { leaving: { player: data.player, fade: finite(data.fade) ? Math.max(0, data.fade) : 0 } };
  if (data.active !== true) return null;
  const time = data.position && typeof data.position === "object" ? (data.position as Record<string, unknown>) : null;
  return {
    state: {
      player: data.player,
      tab: finite(data.tab) ? data.tab : 0,
      playing: data.playing === true,
      ended: data.ended === true,
      playPause: data.playPause !== false,
      origin: typeof data.origin === "string" ? data.origin : "",
      natural: { width: finite(data.naturalWidth) ? data.naturalWidth : 0, height: finite(data.naturalHeight) ? data.naturalHeight : 0 },
      position: time && finite(time.current) ? { current: time.current, duration: finite(time.duration) ? time.duration : null, rate: finite(time.rate) ? time.rate : 1, at: now } : null,
    },
  };
}

export function positionAt(position: PlayerPosition | null, playing: boolean, now: number) {
  if (!position) return null;
  const elapsed = playing ? ((now - position.at) / 1000) * position.rate : 0;
  const current = position.current + elapsed;
  return position.duration === null ? current : Math.min(Math.max(0, current), position.duration);
}

export function startPipPlayer(host: ArdiaHost, now: () => number = () => performance.now()) {
  if (!hostSupports(PIP_ATTACH, host)) return () => {};
  const stored = host.bootstrap.documents?.[PIP_FRAME_DOCUMENT];
  if (stored) usePipPlayer.setState({ frame: parseFrame(stored) });
  else {
    void invokeHost<unknown>("ArdiaShell.readDocument", { args: [PIP_FRAME_DOCUMENT] }, host).then((text) => {
      if (typeof text === "string" && !usePipPlayer.getState().frame) usePipPlayer.setState({ frame: parseFrame(text) });
    }, () => {});
  }
  const stop = host.onEvent((module, event, payload) => {
    if (module !== "ArdiaPip" || event !== "player") return;
    const read = readPlayerEvent(payload, now());
    if (!read) return;
    if ("state" in read) usePipPlayer.setState({ state: read.state, leaving: null });
    else if (usePipPlayer.getState().state?.player === read.leaving.player) usePipPlayer.setState({ state: null, leaving: read.leaving });
  });
  void invokeHost(PIP_ATTACH, {}, host).catch(reportHostError);
  return () => {
    stop();
    usePipPlayer.setState({ state: null, leaving: null });
  };
}

export function sendPlayerViewport(player: number, rect: Rect, visible: boolean, host?: ArdiaHost) {
  return invokeHost<boolean>(PIP_VIEWPORT, { player, rect, visible }, host);
}

export function sendPlayerCommand(player: number, action: string, extra: Record<string, unknown> = {}, host?: ArdiaHost) {
  return invokeHost<boolean>(PIP_COMMAND, { player, action, ...extra }, host).catch(reportHostError);
}

export function savePlayerFrame(frame: PlayerFrame, host?: ArdiaHost) {
  usePipPlayer.setState({ frame });
  return invokeHost<void>("ArdiaShell.writeDocument", { args: [PIP_FRAME_DOCUMENT, JSON.stringify(frame)] }, host).catch(reportHostError);
}
