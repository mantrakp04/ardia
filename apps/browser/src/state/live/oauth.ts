import { base64Url, sha256 } from "../../lib/sha256";
import { secureRandomHex } from "../../platform/secureRandom";
import { useBrowser } from "../browser/store";
import { GITEA_SCOPES } from "./gitea";
import { endpoints, form, httpsSiteUrl } from "./net";
import { giteaTokens } from "./giteaApi";
import { connectGitea, connectGoogle } from "./sources";

export const OAUTH_REDIRECT = "http://127.0.0.1:53682/ardia-oauth";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/drive.metadata.readonly";

let pending: { cancel(): void } | null = null;

function query(url: string): Map<string, string> | null {
  const search = url.split("#")[0]!.split("?")[1] ?? "";
  try {
    return new Map(
      search
        .split("&")
        .filter(Boolean)
        .map((pair) => pair.split("=").map((v) => decodeURIComponent(v.replace(/\+/g, " "))) as [string, string]),
    );
  } catch {
    return null;
  }
}

export const cancelSignIn = () => pending?.cancel();

export function authorizeInTab(windowId: string, url: string, state: string): Promise<Map<string, string>> {
  cancelSignIn();
  const tabId = useBrowser.getState().newTab(windowId, { url });
  return new Promise<Map<string, string>>((resolve, reject) => {
    const stop = useBrowser.subscribe((s, prev) => {
      if (s.tabs === prev.tabs) return;
      const tab = s.tabs[tabId];
      if (!tab) return finish(new Error("Sign-in was cancelled"));
      if (!tab.url.startsWith(OAUTH_REDIRECT)) return;
      const params = query(tab.url);
      if (params?.get("state") !== state) return finish(new Error("Sign-in didn't match this request"));
      finish(null, params);
      useBrowser.getState().closeTab(tabId);
    });
    const finish = (error: unknown, params?: Map<string, string>) => {
      stop();
      pending = null;
      if (params) resolve(params);
      else reject(error);
    };
    pending = {
      cancel: () => {
        finish(new Error("Cancelled"));
        useBrowser.getState().closeTab(tabId);
      },
    };
  });
}

export async function connectGoogleDrive(windowId: string, clientId: string, clientSecret: string): Promise<void> {
  const verifier = secureRandomHex(64);
  const state = secureRandomHex(32);
  const url = `${endpoints.googleAuth}?${form({
    client_id: clientId.trim(),
    redirect_uri: OAUTH_REDIRECT,
    response_type: "code",
    scope: GOOGLE_SCOPE,
    code_challenge: base64Url(sha256(verifier)),
    code_challenge_method: "S256",
    state,
    access_type: "offline",
    prompt: "consent",
  })}`;
  const params = await authorizeInTab(windowId, url, state);
  const code = params.get("code");
  if (!code) throw new Error(params.get("error") ?? "Google didn't grant access");
  await connectGoogle(clientId.trim(), clientSecret.trim(), code, verifier, OAUTH_REDIRECT);
}

export async function signInGitea(windowId: string, site: string, clientId: string): Promise<void> {
  const base = httpsSiteUrl(site);
  const id = clientId.trim();
  const verifier = secureRandomHex(64);
  const state = secureRandomHex(32);
  const url = `${endpoints.gitea(base)}/login/oauth/authorize?${form({
    client_id: id,
    redirect_uri: OAUTH_REDIRECT,
    response_type: "code",
    scope: GITEA_SCOPES,
    code_challenge: base64Url(sha256(verifier)),
    code_challenge_method: "S256",
    state,
  })}`;
  const params = await authorizeInTab(windowId, url, state);
  const code = params.get("code");
  if (!code) throw new Error(params.get("error_description") || params.get("error") || "Gitea didn't grant access");
  const tokens = await giteaTokens(base, { grant_type: "authorization_code", client_id: id, code, code_verifier: verifier, redirect_uri: OAUTH_REDIRECT });
  await connectGitea(base, { ...tokens, clientId: id });
}
