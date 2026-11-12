import { capture } from "./telemetry";
import { normalizedEmail } from "../data/betaEmail";
import { base } from "../data/site";
import { INGEST_KEY_HEADER, SITE_INGEST_KEY } from "../../../../packages/core/src/ingestKeys";

type Result = "ok" | "invalid" | "rate_limited" | "error";

const SIGNUP_PATH = `${base}/api/testflight`;
const TIMEOUT_MS = 10_000;

const MESSAGES: Record<Exclude<Result, "ok">, string> = {
  invalid: "That doesn’t look like an email.",
  rate_limited: "Too many tries from here. Give it a minute.",
  error: "Couldn’t save that. Try again in a moment.",
};

function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

async function send(email: string, website: string): Promise<Result> {
  try {
    const response = await fetch(SIGNUP_PATH, {
      method: "POST",
      headers: { [INGEST_KEY_HEADER]: SITE_INGEST_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ v: 1, email, website }),
      credentials: "omit",
      cache: "no-store",
      signal: timeoutSignal(TIMEOUT_MS),
    });
    if (response.ok) return "ok";
    return response.status === 429 ? "rate_limited" : "error";
  } catch {
    return "error";
  }
}

function wire(root: HTMLElement) {
  const form = root.querySelector<HTMLFormElement>("[data-signup-form]");
  const input = root.querySelector<HTMLInputElement>("[data-signup-email]");
  const honeypot = root.querySelector<HTMLInputElement>("[data-signup-website]");
  const button = root.querySelector<HTMLButtonElement>("[data-signup-submit]");
  const buttonLabel = root.querySelector<HTMLElement>("[data-signup-label]");
  const error = root.querySelector<HTMLElement>("[data-signup-error]");
  const done = root.querySelector<HTMLElement>("[data-signup-done]");
  const doneHeading = root.querySelector<HTMLElement>("[data-signup-done-heading]");
  const sentTo = root.querySelector<HTMLElement>("[data-signup-sent-to]");
  const again = root.querySelector<HTMLButtonElement>("[data-signup-again]");
  if (!form || !input || !button || !buttonLabel || !error || !done || !doneHeading || !sentTo || !again) return;

  const idleLabel = buttonLabel.textContent ?? "";
  let busy = false;

  const showError = (message: string) => {
    error.textContent = message;
    input.setAttribute("aria-invalid", "true");
  };
  const clearError = () => {
    error.textContent = "";
    input.removeAttribute("aria-invalid");
  };
  const setBusy = (on: boolean) => {
    busy = on;
    button.disabled = on;
    form.setAttribute("aria-busy", String(on));
    buttonLabel.textContent = on ? "Sending…" : idleLabel;
  };

  input.addEventListener("input", () => {
    if (input.hasAttribute("aria-invalid")) clearError();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    const email = normalizedEmail(input.value);
    if (!email) {
      capture("iphone_signup", { result: "invalid" });
      showError(MESSAGES.invalid);
      input.focus();
      return;
    }
    clearError();
    setBusy(true);
    const result = await send(email, honeypot?.value ?? "");
    setBusy(false);
    capture("iphone_signup", { result });
    if (result !== "ok") {
      showError(MESSAGES[result]);
      input.focus();
      return;
    }
    sentTo.textContent = email;
    form.hidden = true;
    done.hidden = false;
    doneHeading.focus();
  });

  again.addEventListener("click", () => {
    sentTo.textContent = "";
    input.value = "";
    clearError();
    done.hidden = true;
    form.hidden = false;
    input.focus();
  });
}

for (const root of document.querySelectorAll<HTMLElement>("[data-signup]")) wire(root);
