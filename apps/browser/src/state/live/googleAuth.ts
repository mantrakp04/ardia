import { useBrowser } from "../browser/store";
import { endpoints, form } from "./net";
import { connectGoogle } from "./sources";
import { secureRandomHex } from "../../platform/secureRandom";
import { base64Url, sha256 } from "../../lib/sha256";

const REDIRECT = "http://127.0.0.1:53682/ardia-oauth";
const SCOPE = "https://www.googleapis.com/auth/drive.metadata.readonly";

let pending: { cancel(): void } | null = null;

function query(url: string): Map<string, string> {
  const search = url.split("#")[0]!.split("?")[1] ?? "";
  return new Map(
    search
      .split("&")
      .filter(Boolean)
      .map((pair) => pair.split("=").map((v) => decodeURIComponent(v.replace(/\+/g, " "))) as [string, string]),
  );
}

export function connectGoogleDrive(windowId: string, clientId: string, clientSecret: string): Promise<void> {
  pending?.cancel();
  const verifier = secureRandomHex(64);
  const state = secureRandomHex(32);
  const url = `${endpoints.googleAuth}?${form({
    client_id: clientId.trim(),
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPE,
    code_challenge: base64Url(sha256(verifier)),
    code_challenge_method: "S256",
    state,
    access_type: "offline",
    prompt: "consent",
  })}`;
  const tabId = useBrowser.getState().newTab(windowId, { url });
  return new Promise<void>((resolve, reject) => {
    const stop = useBrowser.subscribe((s, prev) => {
      if (s.tabs === prev.tabs) return;
      const tab = s.tabs[tabId];
      if (!tab) return finish(new Error("Sign-in was cancelled"));
      if (!tab.url.startsWith(REDIRECT)) return;
      const params = query(tab.url);
      if (params.get("state") !== state) return finish(new Error("Sign-in didn't match this request"));
      const code = params.get("code");
      stop();
      useBrowser.getState().closeTab(tabId);
      if (!code) return finish(new Error(params.get("error") ?? "Google didn't grant access"));
      connectGoogle(clientId.trim(), clientSecret.trim(), code, verifier, REDIRECT).then(() => finish(), finish);
    });
    const finish = (error?: unknown) => {
      stop();
      pending = null;
      if (error) reject(error);
      else resolve();
    };
    pending = { cancel: () => finish(new Error("Cancelled")) };
  });
}
