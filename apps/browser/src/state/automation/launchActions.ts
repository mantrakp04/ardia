import { automationCommands, automationDecision, isCatalogCommand, variantsOf } from "./automationCommands";

export type LaunchAction = { command: string; arg: string | null };

export const MAX_LAUNCH_ACTIONS = 20;

export function parseLaunchAction(entry: string): LaunchAction | string {
  const colon = entry.indexOf(":");
  const command = colon < 0 ? entry : entry.slice(0, colon);
  const arg = colon < 0 ? null : entry.slice(colon + 1);
  if (!isCatalogCommand(command)) return `${command} isn't a command`;
  if (automationDecision(command) !== "run") return `${command} can't run from launchActions`;
  const variants = variantsOf(command);
  if (arg !== null && !variants?.includes(arg)) return variants ? `${command} takes one of: ${variants.join(", ")}` : `${command} takes no argument`;
  return { command, arg };
}

export const launchActionIds = (): string[] => automationCommands().flatMap((c) => [c.id, ...(c.variants ?? []).map((v) => `${c.id}:${v}`)]);
