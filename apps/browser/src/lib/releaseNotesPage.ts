import { systemInfo } from "@ardia/shell";
import { openUrls } from "./actions";

function releaseNotesUrl(version = systemInfo().appVersion): string | null {
  const page = systemInfo().releaseNotesURL;
  if (!page || !/^https?:\/\//i.test(page)) return null;
  return version ? `${page}#${version}` : page;
}

export function openReleaseNotesPage(windowId?: string | null, options: { notify?: boolean } = {}) {
  const url = releaseNotesUrl();
  if (url) openUrls([url], windowId, options);
}

export function openReleaseNotesAfterUpdate() {
  const info = systemInfo();
  if (!info.forceReleaseNotes && (__DEV__ || info.isolatedInstance !== false)) return;
  openReleaseNotesPage(undefined, { notify: false });
}
