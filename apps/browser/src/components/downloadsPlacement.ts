export const DOWNLOADS_PANEL = { width: 300, margin: 8, arrowWidth: 20, arrowHeight: 9, arrowGap: 1 } as const;

export type Rect = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };
export type DownloadsFallback = { topStrip: boolean; footer: boolean; footerBottom: number };

export type DownloadsPlacement = {
  width: number;
  left: number;
  top?: number;
  bottom?: number;
  arrow: "top" | "bottom" | "none";
  arrowX: number;
  room: number;
};

const FALLBACK_TOP = 44;
const FALLBACK_SIDEBAR_LEFT = 10;

export function anchorInside(viewport: Size, anchor: Rect | null | undefined): anchor is Rect {
  if (!anchor || anchor.width <= 0 || anchor.height <= 0) return false;
  return anchor.x >= 0 && anchor.y >= 0 && anchor.x + anchor.width <= viewport.width && anchor.y + anchor.height <= viewport.height;
}

export function downloadsPlacement(viewport: Size, anchor: Rect | null, fallback: DownloadsFallback): DownloadsPlacement {
  const { margin, arrowHeight, arrowGap } = DOWNLOADS_PANEL;
  const width = Math.max(0, Math.min(DOWNLOADS_PANEL.width, viewport.width - margin * 2));
  if (!anchorInside(viewport, anchor)) {
    const left = fallback.topStrip ? Math.max(margin, viewport.width - margin - width) : FALLBACK_SIDEBAR_LEFT;
    if (fallback.footer) return { width, left, bottom: fallback.footerBottom, arrow: "none", arrowX: width / 2, room: viewport.height - fallback.footerBottom - margin };
    return { width, left, top: FALLBACK_TOP, arrow: "none", arrowX: width / 2, room: viewport.height - FALLBACK_TOP - margin };
  }
  const centre = anchor.x + anchor.width / 2;
  const left = Math.max(margin, Math.min(centre - width / 2, viewport.width - margin - width));
  const arrowX = centre - left;
  const above = anchor.y + anchor.height / 2 > viewport.height / 2;
  if (above) {
    const bottom = viewport.height - anchor.y + arrowGap;
    return { width, left, bottom, arrow: "bottom", arrowX, room: anchor.y - arrowGap - arrowHeight - margin };
  }
  const top = anchor.y + anchor.height + arrowGap;
  return { width, left, top, arrow: "top", arrowX, room: viewport.height - top - arrowHeight - margin };
}
