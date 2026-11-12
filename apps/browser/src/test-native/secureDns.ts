import type { SecureDnsMode, SecureDnsProbe, SecureDnsState } from "@ardia/ardiacore";

const PROVIDERS = [
  { id: "Cloudflare", name: "Cloudflare (1.1.1.1)", templates: "https://cloudflare-dns.com/dns-query", privacyPolicy: "https://developers.cloudflare.com/1.1.1.1/privacy/public-dns-resolver/" },
  { id: "Quad9Secure", name: "Quad9 (9.9.9.9)", templates: "https://dns.quad9.net/dns-query", privacyPolicy: "https://quad9.net/home/privacy/" },
];

const valid = (templates: string) => templates.trim().length > 0 && templates.trim().split(/\s+/).every((t) => /^https:\/\/[^/\s]+\//.test(t));

export const secureDnsEngine = {
  mode: "automatic",
  templates: "",
  policy: false,
  override: "none" as SecureDnsState["override"],
  answers: true,
  writes: [] as { mode: string; templates: string }[],
  reset() {
    Object.assign(this, { mode: "automatic", templates: "", policy: false, override: "none", answers: true, writes: [] });
  },
  state(): SecureDnsState {
    const effectiveMode = (this.override === "none" ? (["automatic", "secure"].includes(this.mode) ? this.mode : "off") : "off") as SecureDnsMode;
    return { prefMode: this.mode, prefTemplates: this.templates, effectiveMode, effectiveTemplates: effectiveMode === "off" ? "" : this.templates, policy: this.policy, override: this.override, providers: PROVIDERS };
  },
  call(args: { mode?: SecureDnsMode; templates?: string }): SecureDnsState {
    if (args.mode !== undefined) {
      if (this.policy || this.override !== "none") throw Object.assign(new Error("secure DNS is set by policy"), { code: "ERR_ENGINE" });
      if (args.mode === "secure" && !valid(args.templates ?? "")) throw Object.assign(new Error("templates aren't a valid DNS-over-HTTPS address"), { code: "ERR_ENGINE" });
      this.mode = args.mode;
      this.templates = args.mode === "secure" ? (args.templates ?? "").trim().split(/\s+/).join(" ") : "";
      this.writes.push({ mode: this.mode, templates: this.templates });
    }
    return this.state();
  },
  probe(templates: string): SecureDnsProbe {
    if (!valid(templates)) return { valid: false, ok: false, result: "invalid" };
    return { valid: true, ok: this.answers, result: this.answers ? "correct" : "unreachable" };
  },
};
