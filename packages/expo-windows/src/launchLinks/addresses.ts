export type LaunchArgument = { text: string; file?: string };
export type LaunchArguments = { arguments: LaunchArgument[]; single?: LaunchArgument };

const SWITCH_PREFIXES = ["--", "-", "/"];
const SWITCH_TERMINATOR = "--";
const SCHEME = /^([a-z][a-z0-9+.-]+):(.*)$/is;
const WEB_REST = /^\/*([^\s/\\?#]+)(.*)$/s;
const DRIVE_PATH = /^[a-z]:[\\/]/i;
const SHARE_PATH = /^\\\\[^\\]+\\[^\\]+/;
const BARE_HOST = /^(?:localhost|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z][a-z0-9-]*)(?::\d{1,5})?(?:[/?#][^\s\\]*)?$/i;

const escapedSpaces = (text: string) => text.replace(/\s/g, (space) => encodeURIComponent(space));

const isSwitch = (text: string) => SWITCH_PREFIXES.some((prefix) => text.length > prefix.length && text.startsWith(prefix));

export function fileUrlOf(path: string): string | null {
  const slashed = path.replace(/\\/g, "/");
  const encode = (segments: string[]) => segments.map((segment) => encodeURIComponent(segment)).join("/");
  if (DRIVE_PATH.test(path)) {
    const [drive, ...rest] = slashed.split("/");
    return `file:///${drive!.toUpperCase()}/${encode(rest)}`;
  }
  if (SHARE_PATH.test(path)) {
    const [host, ...rest] = slashed.slice(2).split("/");
    return `file://${host!.toLowerCase()}/${encode(rest)}`;
  }
  return null;
}

export function addressOf(argument: LaunchArgument): string | null {
  const text = argument.text.trim();
  if (!text) return null;
  const scheme = SCHEME.exec(text);
  if (scheme && !DRIVE_PATH.test(text)) {
    const name = scheme[1]!.toLowerCase();
    if (name === "http" || name === "https") {
      const web = WEB_REST.exec(scheme[2]!);
      return web ? `${name}://${web[1]}${escapedSpaces(web[2]!)}` : null;
    }
    if (name === "file") return escapedSpaces(text);
    return null;
  }
  if (argument.file) return fileUrlOf(argument.file);
  if (DRIVE_PATH.test(text) || SHARE_PATH.test(text)) return fileUrlOf(text);
  return BARE_HOST.test(text) ? `http://${text}` : null;
}

export function launchAddresses(launch: LaunchArguments | null | undefined): string[] {
  if (!launch || !Array.isArray(launch.arguments)) return [];
  const addresses: string[] = [];
  let switchesEnded = false;
  for (const argument of launch.arguments) {
    if (typeof argument?.text !== "string") continue;
    if (!switchesEnded && argument.text === SWITCH_TERMINATOR) {
      switchesEnded = true;
      continue;
    }
    if (!switchesEnded && isSwitch(argument.text)) continue;
    const address = addressOf(argument);
    if (address) addresses.push(address);
  }
  if (typeof launch.single?.text === "string") {
    const address = addressOf(launch.single);
    if (address) addresses.push(address);
  }
  return addresses;
}
