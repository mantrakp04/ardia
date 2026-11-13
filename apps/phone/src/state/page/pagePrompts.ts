export type FindResult = { query: string; activeIndex: number; total: number; isDone: boolean };

export type FindCount = { kind: "match"; label: string } | { kind: "none"; label: string } | null;

export function findCount(result: FindResult | null, query: string): FindCount {
  if (!query || !result || result.query !== query) return null;
  if (result.total === 0) return result.isDone ? { kind: "none", label: "No matches" } : null;
  return { kind: "match", label: `${Math.max(result.activeIndex, 0) + 1} of ${result.total}` };
}

export const findHasMatches = (result: FindResult | null, query: string) => Boolean(result && result.query === query && result.total > 0);

export type SitePermission = "camera" | "microphone" | "cameraAndMicrophone" | "location";

export type RequestKind =
  | { kind: "alert"; text: string }
  | { kind: "confirm"; text: string }
  | { kind: "prompt"; text: string; defaultText: string }
  | { kind: "openExternal"; url: string; app: string }
  | { kind: "httpAuthentication"; realm: string | null; isProxy: boolean; failedBefore: boolean; isSecure: boolean }
  | { kind: "permission"; permission: SitePermission }
  | { kind: "fileChooser"; acceptTypes: string[]; allowsMultiple: boolean; prefersCapture: boolean };

export type Request = RequestKind & { id: string; host: string; title: string; message: string | null };

export type RequestAnswer =
  | { type: "dismiss" }
  | { type: "accept" }
  | { type: "text"; text: string }
  | { type: "credential"; user: string; password: string }
  | { type: "files"; uris: string[] }
  | { type: "pickFiles" };

export type RequestDialog = {
  title: string;
  message: string | null;
  field: "none" | "text" | "credentials";
  defaultText: string;
  confirm: string;
  cancel: string | null;
};

export type RequestPlan = { kind: "dialog"; dialog: RequestDialog } | { kind: "answer"; answer: RequestAnswer };

export function requestPlan(request: Request): RequestPlan {
  const base = { title: request.title, message: request.message, defaultText: "", cancel: "Cancel" as string | null, field: "none" as RequestDialog["field"] };
  switch (request.kind) {
    case "fileChooser":
      return { kind: "answer", answer: { type: "pickFiles" } };
    case "alert":
      return { kind: "dialog", dialog: { ...base, confirm: "OK", cancel: null } };
    case "confirm":
      return { kind: "dialog", dialog: { ...base, confirm: "OK" } };
    case "prompt":
      return { kind: "dialog", dialog: { ...base, field: "text", defaultText: request.defaultText, confirm: "OK" } };
    case "openExternal":
      return { kind: "dialog", dialog: { ...base, confirm: "Open" } };
    case "httpAuthentication":
      return { kind: "dialog", dialog: { ...base, field: "credentials", confirm: "Sign In" } };
    case "permission":
      return { kind: "dialog", dialog: { ...base, confirm: "Allow", cancel: "Don’t Allow" } };
  }
}

export function confirmAnswer(request: Request, text: string, user: string, password: string): RequestAnswer {
  if (request.kind === "prompt") return { type: "text", text };
  if (request.kind === "httpAuthentication") return { type: "credential", user, password };
  return { type: "accept" };
}

export type PressTarget = { kind: "link"; url: string; text: string | null } | { kind: "image"; url: string; linkUrl: string | null };

export type PressAction = "openInNewTab" | "openInBackground" | "copyLink" | "share" | "download" | "saveImage";

export function pressMenuGroups(target: PressTarget): PressAction[][] {
  const opens: PressAction[] = ["openInNewTab", "openInBackground"];
  if (target.kind === "link") return [opens, ["copyLink", "share", "download"]];
  if (target.linkUrl) return [opens, ["copyLink", "share", "download"], ["saveImage"]];
  return [opens, ["copyLink", "share", "saveImage"]];
}

export const pressLinkUrl = (target: PressTarget) => (target.kind === "link" ? target.url : target.linkUrl ?? target.url);

export const pressHeading = (target: PressTarget) => (target.kind === "link" ? target.text || target.url : target.linkUrl ?? target.url);

export const PRESS_TITLES: Record<PressAction, string> = {
  openInNewTab: "Open in New Tab",
  openInBackground: "Open in Background",
  copyLink: "Copy Link",
  share: "Share…",
  download: "Download Linked File",
  saveImage: "Save Image",
};

export type BackLayer = "fullscreen" | "request" | "tray" | "pressMenu" | "reader" | "menu" | "find" | "pageHistory" | "deck";

export type BackState = {
  isFullscreen: boolean;
  hasRequest: boolean;
  isSearching: boolean;
  hasPressMenu: boolean;
  isReading: boolean;
  isMenuOpen: boolean;
  isFinding: boolean;
  canGoBack: boolean;
  hasTab: boolean;
};

export function backLayer(state: BackState): BackLayer | null {
  if (state.isFullscreen) return "fullscreen";
  if (state.hasRequest) return "request";
  if (state.isSearching) return "tray";
  if (state.hasPressMenu) return "pressMenu";
  if (state.isReading) return "reader";
  if (state.isMenuOpen) return "menu";
  if (state.isFinding) return "find";
  if (state.canGoBack) return "pageHistory";
  if (state.hasTab) return "deck";
  return null;
}

export const downloadingToast = (fileName: string) => (fileName ? `Downloading ${fileName}` : "Downloading");

export const downloadedToast = (fileName: string) => `Downloaded ${fileName}`;

export const downloadFailedToast = (fileName: string) => (fileName ? `Couldn’t Download ${fileName}` : "Couldn’t Download File");

export const readingMinutes = (wordCount: number) => Math.max(1, Math.round(wordCount / 230));

export function readerSource(siteName: string, byline: string | null): string | null {
  const parts = [siteName, byline ?? ""].filter((part) => part.length > 0);
  return parts.length ? parts.join(" · ") : null;
}

export const READER_STEPS = [0.8, 0.9, 1, 1.12, 1.25, 1.4, 1.6] as const;
export const READER_DEFAULT_STEP = 2;
export const READER_BASE_SIZE = 19;

export const clampReaderStep = (step: number) => Math.min(Math.max(Math.round(step), 0), READER_STEPS.length - 1);

export const readerBodySize = (step: number) => READER_BASE_SIZE * READER_STEPS[clampReaderStep(step)]!;

export type ReaderTheme = "light" | "sepia" | "dark";

export const readerTheme = (stored: ReaderTheme | null, systemDark: boolean): ReaderTheme => stored ?? (systemDark ? "dark" : "light");
