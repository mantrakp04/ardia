import { isFields, ok, originalProfile, quietly, served, type Engine, type Fields, type Handler, type Handlers } from "./calling";

const profileOfDownload = new Map<string, string>();

function announce(engine: Engine, download: Fields, profile: string) {
  if (typeof download.id === "string") profileOfDownload.set(download.id, profile);
  engine.emit("downloads.changed", { ...download, profile });
}

export function downloadChanged(engine: Engine, payload: Fields) {
  if (!isFields(payload.download)) return;
  announce(engine, payload.download, typeof payload.profile === "string" ? payload.profile : "");
}

export async function watchDownloads(engine: Engine, profile: string): Promise<void> {
  const { downloads } = await served(engine, "ac_downloads_list", originalProfile(profile));
  for (const download of Array.isArray(downloads) ? downloads : []) if (isFields(download)) announce(engine, download, profile);
}

const command =
  (action: string): Handler =>
  async (args, engine) => {
    const id = args.text("id");
    const profile = originalProfile(profileOfDownload.get(id) ?? "");
    quietly(served(engine, "ac_downloads_command", profile, { id, command: action }));
    return ok();
  };

export const downloadCalls: Handlers = {
  cancel: command("cancel"),
  pause: command("pause"),
  resume: command("resume"),
  keep: command("keep"),
};
