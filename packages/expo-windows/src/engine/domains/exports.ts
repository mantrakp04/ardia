import { callError, ok, originalProfile, served, type Desktop, type Engine, type Handler, type Handlers } from "./calling";

export const PASSWORD_FILE_WARNING = "Anyone who can open this file can read your passwords.";

export function desktopOf(engine: Engine): Desktop {
  if (!engine.desktop) throw callError("ERR_UNSUPPORTED", "This build has no Windows dialogs");
  return engine.desktop;
}

export const bookmarkCalls: Handlers = {
  exportHtml: async (args, engine) => {
    const path = await desktopOf(engine).saveFile({ name: "Ardia Bookmarks.html", extension: "html", kind: "Web page", message: "" });
    if (!path) return ok(null);
    await served(engine, "ac_bookmarks_export_html", args.profile, { path });
    return ok(path);
  },
};

export const exportPasswords: Handler = async (args, engine) => {
  const path = await desktopOf(engine).saveFile({ name: "Ardia Passwords.csv", extension: "csv", kind: "CSV file", message: PASSWORD_FILE_WARNING });
  if (!path) return ok({ status: "cancelled" });
  const result = await served(engine, "ac_passwords_export", originalProfile(args.profile), { path });
  return ok(result.status === "succeeded" ? { ...result, path } : result);
};
