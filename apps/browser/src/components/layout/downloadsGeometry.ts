export const DOWNLOADS_LAYOUT = {
  width: 288,
  row: 48,
  header: 38,
  pointer: 10,
  bodyTop: 8,
  bodyBottom: 7,
  separator: 0.5,
  separatorTop: 7,
  separatorBottom: 5,
  footer: 36,
  margin: 8,
};

export function downloadsGeometry(viewport: { width: number; height: number }, anchor: { x: number; y: number; height: number }, footer: boolean) {
  anchor = {
    x: Math.max(16, Math.min(viewport.width - 16, anchor.x)),
    y: Math.max(0, Math.min(viewport.height - anchor.height, anchor.y)),
    height: anchor.height,
  };
  const width = Math.min(DOWNLOADS_LAYOUT.width, Math.max(0, viewport.width - 16));
  const below = !footer && viewport.height - anchor.y - anchor.height >= Math.min(260, anchor.y);
  const edge = below ? anchor.y + anchor.height + 2 : viewport.height - anchor.y + 2;
  const left = Math.max(8, Math.min(anchor.x - width / 2, viewport.width - width - 8));
  const pointerX = Math.max(32, Math.min(width - 32, anchor.x - left));
  const chromeHeight = DOWNLOADS_LAYOUT.bodyTop + DOWNLOADS_LAYOUT.header + DOWNLOADS_LAYOUT.separatorTop + DOWNLOADS_LAYOUT.separator + DOWNLOADS_LAYOUT.separatorBottom + DOWNLOADS_LAYOUT.footer + DOWNLOADS_LAYOUT.bodyBottom;
  const maxHeight = Math.max(0, Math.min(8 * DOWNLOADS_LAYOUT.row, viewport.height - edge - DOWNLOADS_LAYOUT.pointer - chromeHeight - DOWNLOADS_LAYOUT.margin));
  return { width, below, edge, left, pointerX, maxHeight };
}
