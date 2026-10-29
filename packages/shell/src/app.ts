export type AppIcon = { id: string; name: string; preview: string | null };

export type LaunchConfig = {
  dataDirectory: string | null;
  background: boolean;
  isolated: boolean;
  testInstance: boolean;
  instance: Record<string, string>;
  switches: Record<string, boolean>;
  trace: string[];
  test: Record<string, string>;
};

export type SystemInfo = {
  appName: string;
  appVersion: string;
  appBuild: string;
  bundleId: string;
  configuration: "Debug" | "Release";
  osVersion: string;
  osBuild: string;
  arch: string;
  model: string;
  memoryGB: number;
  locale: string;
  feedbackURL?: string | null;
  feedbackEmail?: string | null;
  videoTourURL?: string | null;
  releaseNotesURL?: string | null;
  isolatedInstance?: boolean;
  forceReleaseNotes?: boolean;
  processStart?: number | null;
  bootTime?: number | null;
  inApplicationsFolder?: boolean;
  updatePrewarm?: { build?: string; at?: number; ms?: number; status?: number } | null;
};

export type CrashReport = {
  incidentId?: string;
  time: number;
  appVersion?: string;
  build?: string;
  exceptionType?: string;
  signal?: string;
  frames: NativeFrame[];
  exceptionName?: string;
  exceptionReason?: string;
  exceptionSubtype?: string;
  exceptionFrames?: NativeFrame[];
  images?: { name: string; uuid: string }[];
};

type NativeFrame = { image: string; symbol?: string; symbolOffset?: number; offset?: number };

export type ShareAnchor = [number, number, number, number];

export type IntroMusicCues = {
  icon: number;
  letters: number;
  letterStep: number;
  letterCount: number;
  tagline: number;
  exit: number;
  end: number;
};

export type AppNative = {
  setWindowActivity(windowId: string, url: string | null, title: string | null): Promise<void>;
  share(url: string, title: string | null, windowId: string | null, anchor: ShareAnchor | null): Promise<void>;
  shareVia(service: string, url: string, title: string | null, windowId: string | null): Promise<void>;
  isInDock(): Promise<boolean>;
  addToDock(): Promise<boolean>;
  appIcons(size: number): Promise<AppIcon[]>;
  appIcon(): Promise<string>;
  setAppIcon(id: string): Promise<void>;
  systemInfo(): SystemInfo;
  openExternalURL(url: string): Promise<boolean>;
  launchConfig(): LaunchConfig;
  playIntroMusic(cues: IntroMusicCues, muted: boolean): Promise<void>;
  setIntroMusicMuted(muted: boolean): Promise<void>;
  stopIntroMusic(fade: number): Promise<void>;
  crashReports(since: number): Promise<CrashReport[]>;
};
