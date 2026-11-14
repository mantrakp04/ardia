import type { IncomingLink } from "./linkRules";

let held: IncomingLink[] = [];

export const holdLink = (link: IncomingLink) => {
  held = [...held, link];
};

export const heldLinks = (): readonly IncomingLink[] => held;

export function takeHeldLinks(): IncomingLink[] {
  const taken = held;
  held = [];
  return taken;
}
