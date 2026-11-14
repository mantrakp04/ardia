import { onDevToolsKeyKept } from "../../platform/performance";
import { capture } from "./client";

const MAX_DEVTOOLS_KEY_EVENTS = 20;

let sent = 0;

export function trackDevToolsKeyKept() {
  if (sent >= MAX_DEVTOOLS_KEY_EVENTS) return;
  sent++;
  capture("devtools_key_kept");
}

export const watchDevToolsKeys = () => onDevToolsKeyKept(trackDevToolsKeyKept);
