export type DownloadsPanelOpening = "download" | "button" | "command";
export type DownloadsPanelClosing = "escape" | "outside" | "button" | "command";

const opens: Record<DownloadsPanelOpening, number> = { download: 0, button: 0, command: 0 };
const closes: Record<DownloadsPanelClosing, number> = { escape: 0, outside: 0, button: 0, command: 0 };

export const noteDownloadsPanelOpen = (cause: DownloadsPanelOpening) => void (opens[cause] += 1);
export const noteDownloadsPanelClose = (cause: DownloadsPanelClosing) => void (closes[cause] += 1);
export const noteDownloadsPanelToggle = (opening: boolean, cause: "button" | "command") => (opening ? noteDownloadsPanelOpen(cause) : noteDownloadsPanelClose(cause));

export function takeDownloadsPanelCounts() {
  const taken = {
    downloads_panel_opens_download: opens.download,
    downloads_panel_opens_button: opens.button,
    downloads_panel_opens_command: opens.command,
    downloads_panel_closes_escape: closes.escape,
    downloads_panel_closes_outside: closes.outside,
    downloads_panel_closes_button: closes.button,
    downloads_panel_closes_command: closes.command,
  };
  for (const key of Object.keys(opens) as DownloadsPanelOpening[]) opens[key] = 0;
  for (const key of Object.keys(closes) as DownloadsPanelClosing[]) closes[key] = 0;
  return taken;
}
