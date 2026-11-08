import { systemInfo } from "../../browser/src/platform/app";
import { diagnostics } from "../../browser/src/state/commands/appCommands";
import { openUrls } from "../../browser/src/state/browser/actions";
import { useBrowser } from "../../browser/src/state/browser/store";
import { capture } from "../../browser/src/state/telemetry/client";

export const LINUX_REPORT_URL = "https://github.com/mantrakp04/ardia/issues/new?body=%s";
export const LINUX_REPORT_TEMPLATE = "What happened?\n\n\nWhat did you expect?\n\n\n---\n";

type ReportSource = "menu" | "check_in";

const reportPage = () => {
  const configured = systemInfo().feedbackURL;
  return configured && /^https:\/\//i.test(configured) && configured.includes("%s") ? configured : LINUX_REPORT_URL;
};

export async function reportPageURL(): Promise<string> {
  const body = `${LINUX_REPORT_TEMPLATE}${await diagnostics()}`;
  return reportPage().replace("%s", encodeURIComponent(body));
}

export function openReport(windowId: string | null, source: ReportSource = "menu"): Promise<void> {
  const target = windowId && useBrowser.getState().windows[windowId]?.kind !== "small" ? windowId : null;
  if (!target) return Promise.resolve();
  capture("report_sheet_opened", { source, form: "issue_page" });
  return reportPageURL().then((url) => openUrls([url], target));
}
