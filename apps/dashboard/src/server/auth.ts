import { HexclaveServerApp } from "@hexclave/tanstack-start";
import { getRequest } from "@tanstack/react-start/server";
import { HEXCLAVE_PROJECT_ID } from "../lib/project";
import { viewerFor, type Viewer } from "./admin-gate";
import { devAuthBypass, serverEnv } from "./env";

let app: HexclaveServerApp | null = null;

function serverApp() {
  if (app) return app;
  const secretServerKey = serverEnv("HEXCLAVE_SECRET_SERVER_KEY");
  if (!secretServerKey) throw new Error("HEXCLAVE_SECRET_SERVER_KEY is not set");
  app = new HexclaveServerApp({
    projectId: serverEnv("HEXCLAVE_PROJECT_ID") ?? HEXCLAVE_PROJECT_ID,
    secretServerKey,
    tokenStore: null,
    urls: { default: { type: "hosted" } },
  });
  return app;
}

export async function currentViewer(): Promise<Viewer> {
  if (devAuthBypass()) return { state: "allowed", email: "dev-bypass@localhost" };
  const request = getRequest();
  return viewerFor(await serverApp().getUser({ tokenStore: request }));
}
