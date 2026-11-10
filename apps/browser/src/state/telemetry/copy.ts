export const SHARING_COPY = {
  toggle: "Share anonymous crash reports and usage stats",
  summary: "Crashes, errors, rough feature counts and speed. Never the sites you visit, anything you type or search, or what's in your tabs.",
  whatsSent: "What's Sent",
  footnote:
    "Sent to ardia.dev with a random ID made on this Mac, and kept on our own servers. No third parties. Turning this off stops it at once and deletes anything waiting to be sent. This setting doesn't sync.",
  keptOnThisMac: "Kept on this Mac",
  ask: {
    title: "Help fix Ardia?",
    body: "Share anonymous crash reports and usage stats. No sites, searches or typing. Ever.",
    share: "Share",
    notNow: "Not now",
  },
  dailyCount:
    "One anonymous “opened today” count a day: app version, update channel, macOS version, chip, and whether it's this copy's first day, week or month. No persistent ID.",
  dailyCountShort: "Either way, Ardia sends one anonymous “opened today” count a day, with its version and macOS version and no persistent ID.",
  updateChecks: "ardia.dev counts update checks by version and day, and whether it's this copy's first. Nothing else.",
  switchFile:
    "While update checks are on, each launch also reads ardia.dev/switches.json: one small file, the same for everyone, that lets us turn off a speed-up that misbehaves. It sends no ID, no cookies and nothing about you.",
  onboarding: {
    title: "Help us fix what breaks",
    row: "Crashes, errors, feature counts and speed. Never your sites, typing or tabs.",
    subtitle:
      "Off unless you turn it on; change it any time in Settings › Privacy & Security. Either way, Ardia sends one anonymous “opened today” count a day, with its version and macOS version and no persistent ID.",
  },
} as const;

export const WHATS_SENT: { title: string; items: string[] }[] = [
  {
    title: "With everything",
    items: [
      "A random install ID, made on this Mac once and kept through updates. Nothing is sent with it while sharing is off, except a problem report you send and the 14 days of sharing you can agree to with it",
      "A random ID for each time Ardia opens, so one session's events can be read together",
      "App version and build, macOS version, chip (arm64 or x86_64), engine version",
      "Whether it's a test build",
      "During the 14 days you agreed to after a problem report: that report's reference (like FB-1234)",
    ],
  },
  {
    title: "Crashes and errors",
    items: [
      "The error's type and message, with web addresses, paths, file names, quoted text and long numbers taken out",
      "Function names, script file names and line numbers from the stack trace",
      "After a crash: the exception type and name (never its message), and the function names where it was thrown and on the crashing thread, from this app's crash report",
      "The same for crashes of Ardia's page, graphics and helper processes, plus the version that crashed, how long the process had run, the total size of its writable memory regions, and how the system ended it (its termination reason, like a signal or a code-signing kill)",
      "When a page's process stops (crashed, killed, out of memory or failed to start): why, its exit code, whether the tab was on screen, and how many tabs, windows and profiles were open",
      "Every 10 minutes Ardia notes on this Mac its tab, window and profile counts, its memory use, rough free disk space, the Mac's memory pressure and how long it has been open. That note is sent only with a crash report, or at the next launch after Ardia didn't quit cleanly, with whether the Mac restarted since. Turning sharing off or deleting a profile erases it",
      "Warning and error log lines, cleaned the same way",
    ],
  },
  {
    title: "Usage",
    items: [
      "Launches, updates, and whether the last session ended cleanly",
      "At launch: the chip and graphics chip names, how much memory the Mac has, how many displays and their scale, and whether the Mac decodes AV1, VP9, HEVC and H.264 video in hardware",
      "How many tab presses opened a tab, became a drag or got no answer, and how soon after opening a tab its page was clicked, summed up once an hour. Never where you clicked",
      "How many tabs and windows you open (a count, not which), how often a window goes full screen, how many camera, microphone or screen sharing dots went away because a tab went to sleep or its page stopped, and how often the hidden sidebar peeks out and how many of those came back while it was still sliding away",
      "How many tab and group changes the ardia command made (counts only, never which tabs or groups) and how many of its batches were refused or stopped",
      "When a paste is dropped or finds no text: the reason, the names of the types the clipboard offered, the class of the focused field, your keyboard layout and whether a new tab was still taking focus. Never what is on the clipboard",
      "Opening split view, switching profiles and opening the command bar",
      "Opening Picture in Picture: video or page, and whether its window can show over full-screen apps",
      "How often a site panel (Site Controls, Zoom, blocked pop-ups) is closed by a click outside it or by Esc, how often the ⌃Tab switcher opens and how many closed pinned tabs it left out, summed up once an hour",
      "Whether a profile switch came from the sidebar's profile switcher, whether it showed icons or dots, and whether it came within 2 seconds of a switcher press for a different profile (a corrected mis-click)",
      "The kind of command bar row you pick: history, bookmark, tab, address, search, calculator or action",
      "Installing an extension, turning sync on or off, translating a page, and which Settings sections you open",
      "Once a day, your on/off, pick-one and number settings (like light or dark, glass or classic, and how much tint) and which app icon you picked, each with its default. Never addresses, names, search engines or anything you typed",
      "Bringing your last window back from the Dock or at launch: how many tabs came back and how long it was closed, in rough ranges, and whether a pinned tab was showing",
    ],
  },
  {
    title: "Speed",
    items: [
      "Time to the first window, profile switch time, and command bar speed (a sample of keystrokes)",
      "How long launches, new tabs, tab switches and page loads take, step by step: times and counts only, summed up once an hour",
      "At launch, in rough ranges: how many tabs and windows came back, how much history there is, and whether it's the first launch since the Mac started",
      "Memory use and the number of tabs, once an hour",
    ],
  },
  {
    title: "The ardia command",
    items: [
      "Each command's name (like history or browse snapshot), its exit and error codes, and the names of the options it was given, never their values",
      "How long it took, step by step (starting up, starting its helper, connecting to Ardia, finding the tab, the command itself, waiting for the page to settle), plus counts and sizes: browser calls, steps in a batch, the length of a page snapshot and of the output, how many requests an action sent, and whether the output was cut short or the input humanized. Times, counts and yes or no only",
      "Its version, macOS version, chip and Python version, with this Mac's install ID",
      "After a crash: the error's type (with its message only when it's one of Python's fixed ones, like “division by zero”), and the module, function and line number of each step in the stack trace",
      "Nothing from commands pointed at a test browser (--port, --ws), and nothing at all with DO_NOT_TRACK=1 or ARDIA_TELEMETRY=0 set",
    ],
  },
  {
    title: "Even with sharing off",
    items: [SHARING_COPY.dailyCount, SHARING_COPY.updateChecks, SHARING_COPY.switchFile],
  },
  {
    title: "The local copy",
    items: [
      "Leaves this Mac only as the events above while sharing is on, or when you attach it to a problem report. Settings › Privacy › View My Data saves it to your Downloads folder",
      "Every hour, how big the local copy is and how long writing it took, so we notice if it ever slows Ardia down",
    ],
  },
  {
    title: "Never",
    items: [
      "Web addresses, site names or page titles",
      "Anything you type or search for",
      "History, bookmarks, passwords or what's in your tabs",
      "Profile, extension or file names",
      "What you give the ardia command: addresses, selectors, typed text, scripts, notes or paths",
      "Screen recordings",
    ],
  },
];

export const IDENTITY_COPY = {
  appearAs: (name: string) => `You appear to us as ${name}`,
  noId: "No anonymous ID yet",
  noIdDetail: "One is made the first time you share or send a problem report.",
  idDetail: (shortId: string) => `ID ${shortId}…, shown as a name and colours made from it. Never stored or sent.`,
  reset: "Reset My Anonymous ID",
  resetTitle: "Reset your anonymous ID?",
  resetBody: "Ardia makes a new random ID. Anything sent from now on can't be tied to what was sent before, and the copy kept on this Mac is deleted.",
  resetConfirm: "Reset",
  resetDone: (name: string) => `You now appear to us as ${name}.`,
} as const;

export const LOCAL_COPY = {
  title: "Kept on this Mac",
  summary:
    "Ardia keeps the last 7 days of what it records here (at most 8 MB), whether sharing is on or off, so a problem report can include what led up to it.",
  viewData: "View My Data",
  viewDataDetail: "Saves the local copy to your Downloads folder and shows it in Finder.",
  exported: (lines: number) => `Saved ${lines.toLocaleString()} ${lines === 1 ? "line" : "lines"} to Downloads`,
  exportFailed: "Couldn't save your data",
  items: [
    "Each event and warning or error line listed in What's Sent, with whether it was sent",
    "With sharing off, they carry no install ID and stay here",
    "Kept 7 days and 8 MB at most, oldest first out; checked when Ardia opens and every hour",
    "Never leaves this Mac unless sharing is on or you attach it to a problem report",
    "Resetting your anonymous ID deletes it",
  ],
} as const;

export const WATCH_COPY = {
  rowTitle: "Sharing to confirm a fix",
  rowDetail: (report: string, until: string) => `Sharing crash reports and usage for ${report} until ${until}, then it turns off by itself.`,
  rowDetailAlreadySharing: (report: string, until: string) => `Following ${report} until ${until}.`,
  stop: "Stop Now",
  endedTitle: "Sharing is off again",
  endedMessage: (report: string) => `The 14 days you shared for ${report} are over. Thanks for helping fix it.`,
  endedAction: "Settings",
} as const;
