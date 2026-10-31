import { securityVerdict } from "../lib/assertions.mjs";
import { navigateTab, startBrowser } from "../lib/flows.mjs";
import { sitePanelText } from "../lib/ui.mjs";
import { nonce } from "../lib/util.mjs";

export default {
  id: "F03",
  issue: 13,
  title: "Site panel connection security for HTTPS, HTTP, mixed, invalid-certificate and internal pages",
  deadline: 300000,
  async run(t) {
    const run = nonce("f03");
    const { shell } = await startBrowser(t, { name: "security" });
    const { url } = t.fixtures;
    const tabId = await shell.newTab(url.page(1, run));
    await shell.waitTabUrl(tabId, (u) => u.startsWith(url.page(1)));
    const cases = [
      { kind: "secure", url: url.secure() },
      { kind: "insecure", url: url.insecure() },
      { kind: "mixed", url: url.mixed() },
      { kind: "certificateError", url: url.badcert() },
      { kind: "secure", url: `${url.secure()}?again=${run}`, label: "secure again after a bad certificate" },
      { kind: "insecure", url: `${url.insecure()}?after=${run}`, label: "insecure after secure keeps no certificate", noCertificate: true },
      { kind: "internal", url: "chrome://version/", match: (u) => /^(chrome|ardia):\/\/version/.test(u) },
    ];
    for (const entry of cases) {
      await t.check(`site panel: ${entry.label ?? entry.kind}`, async () => {
        await navigateTab(shell, tabId, entry.url, entry.match ? { match: entry.match } : {});
        await new Promise((resolve) => setTimeout(resolve, 600));
        const text = await sitePanelText(shell);
        await t.evidence(`site-panel-${entry.label ?? entry.kind}`.replace(/[^A-Za-z0-9-]+/g, "-"), { url: entry.url, text });
        const verdict = securityVerdict(entry.kind, text);
        if (entry.noCertificate && text.includes("Certificate issued by")) verdict.problems.push("the previous document's certificate is still shown");
        if (verdict.problems.length) throw new Error(verdict.problems.join("; "));
        return verdict.seen;
      });
    }
    await t.screenshot(shell, "site-panel-last");
  },
};
