import type { ImageRequireSource } from "react-native";

type Icon = ImageRequireSource | readonly [light: ImageRequireSource, dark: ImageRequireSource];

const GITHUB: Icon = [require("../../../assets/site-icons/github.png"), require("../../../assets/site-icons/github-dark.png")];
const NOTION: Icon = require("../../../assets/site-icons/notion.png");
const OUTLOOK: Icon = require("../../../assets/site-icons/outlook.png");

const ICONS: Record<string, Icon> = {
  "mail.google.com": require("../../../assets/site-icons/gmail.png"),
  "calendar.google.com": require("../../../assets/site-icons/calendar.png"),
  "docs.google.com/": require("../../../assets/site-icons/docs.png"),
  "docs.google.com/document": require("../../../assets/site-icons/docs.png"),
  "drive.google.com": require("../../../assets/site-icons/drive.png"),
  "app.slack.com": require("../../../assets/site-icons/slack.png"),
  "notion.so": NOTION,
  "notion.com": NOTION,
  "figma.com": require("../../../assets/site-icons/figma.png"),
  "github.com": GITHUB,
  "linear.app": require("../../../assets/site-icons/linear.png"),
  "outlook.office.com": OUTLOOK,
  "outlook.office365.com": OUTLOOK,
  "outlook.live.com": OUTLOOK,
  "youtube.com": require("../../../assets/site-icons/youtube.png"),
  "open.spotify.com": require("../../../assets/site-icons/spotify.png"),
  "google.com": require("../../../assets/site-icons/google.png"),
  "bing.com": require("../../../assets/site-icons/bing.png"),
  "duckduckgo.com": require("../../../assets/site-icons/duckduckgo.png"),
  "ecosia.org": require("../../../assets/site-icons/ecosia.png"),
  "search.brave.com": require("../../../assets/site-icons/brave-search.png"),
  "kagi.com": require("../../../assets/site-icons/kagi.png"),
  "startpage.com": require("../../../assets/site-icons/startpage.png"),
};

const PAGE = /^https?:\/\/(?:www\.)?([^/?#:@]+)(?::\d+)?(?:\/([^/?#]*))?/i;

export function bundledSiteIcon(url: string, dark: boolean): ImageRequireSource | undefined {
  const match = PAGE.exec(url);
  if (!match) return undefined;
  const host = match[1]!.toLowerCase();
  const icon = ICONS[`${host}/${match[2] ?? ""}`] ?? ICONS[host];
  if (icon === undefined) return undefined;
  return Array.isArray(icon) ? icon[dark ? 1 : 0] : (icon as ImageRequireSource);
}
