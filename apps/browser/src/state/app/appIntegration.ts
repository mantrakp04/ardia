import { isDefaultBrowser, setAsDefaultBrowser, systemInfo } from "../../platform/app";
import { onNotificationResponse } from "../../platform/notifications";
import { readDocument, saveDocument } from "../../platform/documents";
import { maybeStartOnboarding, onboardingCompletedAt, useOnboarding } from "../onboarding/onboarding";
import { trackAppVersion } from "../releaseNotes/releaseNotes";
import { useBrowser } from "../browser/store";
import { focus, switchToTab } from "../browser/actions";
import { afterFirstWindow } from "../../lib/afterFirstWindow";
import { offerDefaultBrowserAgain } from "../onboarding/defaultBrowserOffer";
import { openReleaseNotesAfterUpdate } from "../releaseNotes/releaseNotesPage";
import { handleWebNotificationResponse } from "../site/webNotifications";
import { startHandoff } from "./handoff";
import { startScripting } from "./scripting";

export function startAppIntegration() {
  onNotificationResponse((response) => {
    if (handleWebNotificationResponse(response) || response.action !== "click") return;
    const s = useBrowser.getState();
    const { tabId, windowId } = response;
    if (tabId && s.tabs[tabId]) switchToTab(tabId);
    else if (windowId && s.windows[windowId]) focus(windowId);
  });
  startHandoff();
  startScripting();
  const updated = trackAppVersion();
  maybeStartOnboarding();
  if (updated) openReleaseNotesAfterUpdate();
  afterFirstWindow(() => {
    void offerDefaultBrowserAgain({
      read: readDocument,
      save: saveDocument,
      testInstance: systemInfo().isolatedInstance !== false,
      onboarding: !onboardingCompletedAt() || useOnboarding.getState().windowId !== null,
      isDefault: isDefaultBrowser,
      setDefault: setAsDefaultBrowser }).catch((error) => console.warn("[defaultBrowserOffer]", error));
  });
}
