export const AUTOMATION_EVENTS = [
  "window.opened",
  "window.closed",
  "window.focused",
  "tab.opened",
  "tab.closed",
  "tab.activated",
  "tab.navigated",
  "settings.changed",
  "app.launched",
  "app.quitting",
  "app.activated",
  "app.deactivated",
  "tab.idle",
  "tab.resumed",
  "media.started",
  "media.stopped",
  "tab.crashed",
  "notification.shown",
  "peek.opened",
  "peek.closed",
  "littleArdia.opened",
  "split.created",
  "split.closed",
  "pin.added",
  "pin.removed",
  "tab.moved",
  "profile.switched",
  "system.sleep",
  "system.wake",
  "user.idle",
  "user.active",
  "page.error",
] as const;
export type AutomationEventName = (typeof AUTOMATION_EVENTS)[number];

export const NAMED_ONLY_EVENTS: ReadonlySet<AutomationEventName> = new Set([
  "notification.shown",
  "app.activated",
  "app.deactivated",
  "system.sleep",
  "system.wake",
  "user.idle",
  "user.active",
]);

export const CORE_EVENTS: ReadonlySet<string> = new Set([
  "window.opened",
  "window.closed",
  "window.focused",
  "tab.opened",
  "tab.closed",
  "tab.activated",
  "tab.navigated",
  "settings.changed",
  "page.error",
]);

export const TAB_IDLE_EVENTS: ReadonlySet<string> = new Set(["tab.idle", "tab.resumed"]);
export const USER_IDLE_EVENTS: ReadonlySet<string> = new Set(["user.idle", "user.active"]);

export const DECIDE_EVENTS = ["tab.opening", "link.opening", "download.deciding", "permission.requested"] as const;
export type DecideEvent = (typeof DECIDE_EVENTS)[number];

export const DECIDE_DEADLINE_MS: Record<DecideEvent | "omnibox.query", number> = {
  "tab.opening": 250,
  "link.opening": 250,
  "download.deciding": 2000,
  "permission.requested": 2000,
  "omnibox.query": 300,
};

export const LAUNCH_REPLAY_MS = 120_000;
export const MIN_IDLE_SECONDS = 60;

export const isAutomationEvent = (name: string): name is AutomationEventName => (AUTOMATION_EVENTS as readonly string[]).includes(name);
export const isDecideEvent = (name: string): name is DecideEvent => (DECIDE_EVENTS as readonly string[]).includes(name);
