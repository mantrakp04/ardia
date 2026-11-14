import { callError, ok, originalProfile, served, type Desktop, type Engine, type Fields, type Handler, type Handlers } from "./calling";

export const PASSWORD_FILE_WARNING = "Anyone who can open this file can read your passwords.";
export const EXPORT_ANSWER_MS = 120_000;

const TIMED_OUT = Symbol("timed out");

export function desktopOf(engine: Engine): Desktop {
  if (!engine.desktop) throw callError("ERR_UNSUPPORTED", "This build has no Windows dialogs");
  return engine.desktop;
}

function withinLimit<Value>(answer: Promise<Value>): Promise<Value | typeof TIMED_OUT> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), EXPORT_ANSWER_MS);
    answer.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export const bookmarkCalls: Handlers = {
  exportHtml: async (args, engine) => {
    const path = await desktopOf(engine).saveFile({ name: "Ardia Bookmarks.html", extension: "html", kind: "Web page", message: "" });
    if (!path) return ok(null);
    const answer = await withinLimit(served(engine, "ac_bookmarks_export_html", args.profile, { path }));
    if (answer === TIMED_OUT) throw callError("ERR_ENGINE", "The export didn't finish");
    return ok(path);
  },
};

export const exportPasswords: Handler = async (args, engine) => {
  const path = await desktopOf(engine).saveFile({ name: "Ardia Passwords.csv", extension: "csv", kind: "CSV file", message: PASSWORD_FILE_WARNING });
  if (!path) return ok({ status: "cancelled" });
  const result: Fields | typeof TIMED_OUT = await withinLimit(served(engine, "ac_passwords_export", originalProfile(args.profile), { path }));
  if (result === TIMED_OUT) return ok({ status: "writeFailed" });
  return ok(result.status === "succeeded" ? { ...result, path } : result);
};
