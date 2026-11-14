export const PHONE_SHARING_COPY = {
  toggle: "Share anonymous usage stats",
  summary: "How fast Ardia opens, rough counts of what you use, and how often a page stops. Never the sites you visit, anything you type or search, or what’s in your tabs.",
  whatsSent: "What’s Sent",
  footnote:
    "Off unless you turn it on. Sent to ardia.dev with a random ID made on this phone, and kept on our own servers. No third parties. Turning it off stops it at once and deletes anything waiting to be sent. This setting doesn’t sync.",
  onboardingNote: "Off unless you turn it on. Change it any time in Settings.",
} as const;

export type SentItem = { text: string; fields: readonly string[] };

export const PHONE_WHATS_SENT: { title: string; items: SentItem[] }[] = [
  {
    title: "With everything",
    items: [
      {
        text: "A random install ID, made on this phone the first time you turn sharing on and kept through updates. Nothing is sent with it while sharing is off",
        fields: ["distinct_id"],
      },
      { text: "A random ID for each time Ardia opens, so one session’s events can be read together, and a random ID for each event", fields: ["$session_id", "uuid"] },
      { text: "That it came from Ardia’s phone app, and which version of its reporting it uses", fields: ["app", "$app_name", "$lib", "$lib_version"] },
      { text: "Android or iOS, and its version number", fields: ["platform", "$os", "$os_version"] },
      { text: "Ardia’s version number, and whether it’s a test build", fields: ["$app_version", "$environment"] },
      { text: "Two flags asking our servers not to build a profile and not to work out a location from your connection", fields: ["$process_person_profile", "$geoip_disable"] },
      { text: "When it happened", fields: ["timestamp"] },
    ],
  },
  {
    title: "Usage",
    items: [
      { text: "When you turn sharing on: whether you did it in Settings or during setup", fields: ["sharing_turned_on", "source"] },
      {
        text: "Each launch, and whether Ardia brought over the old iPhone app’s tabs and history, found it already had its own, or had nothing to bring over. Never what it brought",
        fields: ["app_launched", "legacy_import"],
      },
      {
        text: "How long Ardia took to open, from when the system started it to its first screen, and how much of that passed before its code began to run",
        fields: ["perf_launch", "launch_ms", "js_ms"],
      },
      {
        text: "Once a day, for the day before: how many tabs you opened, searches you made, pages you pinned to your Mac, tabs you sent to another device, and pages that stopped working because their page process ended. Counts only, never which",
        fields: ["usage_counts", "tabs_opened", "searches", "pins_to_mac", "tabs_sent", "page_processes_gone"],
      },
    ],
  },
];
