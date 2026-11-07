(() => {
  const form = document.getElementById("review");
  const summary = document.getElementById("summary");
  const summaryList = document.getElementById("summary-list");
  const status = document.getElementById("status");
  const submit = document.getElementById("submit");
  const done = document.getElementById("done");
  const doneMeta = document.getElementById("done-meta");
  const doneValues = document.getElementById("done-values");
  const FIELDS = ["vendor", "api_version", "team_rate_limit", "webhook_payload_kb", "webhook_signature", "enterprise_audit_days", "offsets_sunset", "confirm_sources"];
  const LABELS = {
    vendor: "Vendor name",
    api_version: "API version reviewed",
    team_rate_limit: "Team plan rate limit",
    webhook_payload_kb: "Maximum webhook payload size",
    webhook_signature: "Webhook signing",
    enterprise_audit_days: "Enterprise audit log retention",
    offsets_sunset: "Sunset date",
    confirm_sources: "Confirmation",
  };
  const SIGNATURE_NAMES = { none: "Not signed", "hmac-sha1": "HMAC-SHA1", "hmac-sha256": "HMAC-SHA256", ed25519: "Ed25519 signature", mtls: "Mutual TLS only" };

  function focusTarget(name) {
    return name === "webhook_signature" ? form.querySelector('input[name="webhook_signature"]') : document.getElementById(name);
  }

  function clearErrors() {
    summary.hidden = true;
    summaryList.replaceChildren();
    for (const name of FIELDS) {
      const el = document.getElementById(`${name}-error`);
      el.hidden = true;
      el.textContent = "";
      const input = focusTarget(name);
      input.removeAttribute("aria-invalid");
      const described = (input.getAttribute("aria-describedby") || "").split(" ").filter((id) => id && id !== `${name}-error`);
      if (described.length) input.setAttribute("aria-describedby", described.join(" "));
      else input.removeAttribute("aria-describedby");
    }
  }

  function showErrors(errors) {
    for (const [name, message] of Object.entries(errors)) {
      const el = document.getElementById(`${name}-error`);
      if (!el) continue;
      el.textContent = message;
      el.hidden = false;
      const input = focusTarget(name);
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", `${input.getAttribute("aria-describedby") || ""} ${name}-error`.trim());
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = `#${input.id || name}`;
      a.textContent = `${LABELS[name]}: ${message}`;
      a.addEventListener("click", (event) => {
        event.preventDefault();
        focusTarget(name).focus();
      });
      li.append(a);
      summaryList.append(li);
    }
    summary.hidden = false;
    summary.focus();
  }

  function values() {
    const data = new FormData(form);
    return {
      vendor: data.get("vendor") || "",
      api_version: data.get("api_version") || "",
      team_rate_limit: data.get("team_rate_limit") || "",
      webhook_payload_kb: data.get("webhook_payload_kb") || "",
      webhook_signature: data.get("webhook_signature") || "",
      enterprise_audit_days: data.get("enterprise_audit_days") || "",
      offsets_sunset: data.get("offsets_sunset") || "",
      notes: data.get("notes") || "",
      confirm_sources: document.getElementById("confirm_sources").checked ? "on" : "",
    };
  }

  function showDone(sent, result) {
    doneMeta.textContent = `Reference NW-IR-${String(4180 + result.number)}. Security will follow up if anything needs a second look.`;
    const rows = [
      ["Vendor", sent.vendor],
      ["API version", sent.api_version],
      ["Team plan rate limit", `${sent.team_rate_limit} requests / minute`],
      ["Max webhook payload", `${sent.webhook_payload_kb} KB`],
      ["Webhook signing", SIGNATURE_NAMES[sent.webhook_signature] || sent.webhook_signature],
      ["Enterprise audit retention", `${sent.enterprise_audit_days} days`],
      ["Sunset date", sent.offsets_sunset],
    ];
    doneValues.replaceChildren(...rows.flatMap(([k, v]) => {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      return [dt, dd];
    }));
    form.hidden = true;
    done.hidden = false;
    done.focus();
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearErrors();
    const sent = values();
    submit.disabled = true;
    status.textContent = "Submitting…";
    try {
      const response = await fetch("/api/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sent) });
      const result = await response.json();
      if (response.status === 422) {
        status.textContent = "";
        showErrors(result.errors || {});
        return;
      }
      if (!response.ok) throw new Error(result.error || "Request failed");
      status.textContent = "";
      showDone(sent, result);
    } catch {
      status.textContent = "Couldn’t submit. Check your connection and try again.";
    } finally {
      submit.disabled = false;
    }
  });

  document.getElementById("edit").addEventListener("click", () => {
    done.hidden = true;
    form.hidden = false;
    document.getElementById("vendor").focus();
  });
})();
