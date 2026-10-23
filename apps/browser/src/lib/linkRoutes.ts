import { routeExternalLinks, routeTypedLink, setLinkRouting, type ExternalLink, type LinkDecision, type LinkRoutingConfig } from "@ardia/ardiacore";
import { useBrowser, type BrowserState } from "../store/browser";
import { engineProfile } from "../store/model";
import { lastActiveProfile } from "../store/small";

export function linkRoutingConfig(s: BrowserState): LinkRoutingConfig {
  const { rules, defaultDestination } = s.settings.linkRouting;
  return {
    rules: rules.map(({ match, text, destination }) => ({ match, text, destination })),
    defaultDestination,
    profiles: Object.fromEntries(s.profileOrder.filter((id) => s.profiles[id]).map((id) => [id, engineProfile(id)])),
    recent: lastActiveProfile(s),
  };
}

let installed: Promise<void> = Promise.resolve();
let waiting: (() => void)[] | null = [];

function install(config: LinkRoutingConfig) {
  const next = installed.catch(() => {}).then(() => setLinkRouting(config));
  installed = next;
  next.then(
    () => {
      const ready = waiting;
      waiting = null;
      ready?.forEach((run) => run());
    },
    (error) => console.warn("Couldn't install link routing", error),
  );
}

export function whenLinkRoutingInstalled(run: () => void) {
  if (waiting) waiting.push(run);
  else run();
}

export function startLinkRouting() {
  let last = JSON.stringify(linkRoutingConfig(useBrowser.getState()));
  install(JSON.parse(last) as LinkRoutingConfig);
  useBrowser.subscribe((s, prev) => {
    const same =
      s.settings.linkRouting === prev.settings.linkRouting &&
      s.settings.defaultProfileId === prev.settings.defaultProfileId &&
      s.profiles === prev.profiles &&
      s.profileOrder === prev.profileOrder &&
      s.ui.lastProfileId === prev.ui.lastProfileId &&
      s.ui.focusOrder === prev.ui.focusOrder &&
      s.windowOrder === prev.windowOrder &&
      s.windows === prev.windows;
    if (same) return;
    const config = linkRoutingConfig(s);
    const json = JSON.stringify(config);
    if (json === last) return;
    last = json;
    install(config);
  });
}

export function destinationStillMaps(profileId: string, engine: string): boolean {
  const s = useBrowser.getState();
  return !!s.profiles[profileId] && engineProfile(profileId) === engine;
}

export async function resolveTypedLink(url: string, profileId: string): Promise<LinkDecision | null> {
  try {
    await installed;
    return await routeTypedLink(url, profileId);
  } catch {
    return null;
  }
}

export async function resolveExternalLinks(urls: string[]): Promise<(ExternalLink | null)[] | null> {
  try {
    await installed;
    return await routeExternalLinks(urls);
  } catch {
    return null;
  }
}
