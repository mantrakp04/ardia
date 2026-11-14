import type { SettingsPane } from "../../../state/settings/settingsWindows";
import type { SettingSection } from "./types";

const LINK_WORDS = ["arc", "air traffic control", "atc", "links from other apps", "route links", "open links in profile", "default browser"];

export const airTrafficRows = {
  airTraffic: [
    {
      section: "Rules",
      rows: {
        rules: {
          title: "Link rules",
          description: "Checked from the top. The first rule that fits a link decides where it opens.",
          keywords: [...LINK_WORDS, "work profile", "rule", "add rule"],
        },
      },
    },
    {
      section: "Everything Else",
      rows: {
        fallback: {
          title: "Links no rule catches",
          description: "Where links open when no rule or hook decides.",
          keywords: ["everything else", "fallback", "otherwise", "air traffic control", "links from other apps"],
        },
      },
    },
    {
      section: "From hooks.json",
      rows: {
        hooks: {
          advanced: true,
          title: "Link hooks from hooks.json",
          description: "Checked after your rules. Approve or revoke them in Advanced › Automation.",
          keywords: ["hooks", "hooks.json", "link.opening", "automation"],
        },
      },
    },
    {
      section: "Try a Link",
      rows: {
        tryLink: {
          title: "Try a link",
          description: "See where a link from an app would open. Nothing opens.",
          keywords: [...LINK_WORDS, "test", "preview", "check"],
        },
      },
    },
  ],
} satisfies Pick<Record<SettingsPane, SettingSection[]>, "airTraffic">;
