import json
import os
import re
import shutil
import subprocess
from pathlib import Path

from ardia_cli.browse import paths
from ardia_cli.browse.errors import BrowseError, Usage

PROTOCOL = "agent-browser.plugin.v1"
REGISTRY = "registry.json"
RUN_TIMEOUT = 60
MAX_REPLY = 1024 * 1024
NPM_NAME = re.compile(r"^(@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$")
GITHUB = re.compile(r"^([A-Za-z0-9][A-Za-z0-9-]*)/([A-Za-z0-9._-]+)(?:#([A-Za-z0-9._/-]+))?$")


def plugin_dir(root) -> int:
    browse = paths.browse_dir(root)
    try:
        return paths.open_private_dirat(browse, "plugins")
    finally:
        os.close(browse)


def registry(root) -> list[dict]:
    folder = plugin_dir(root)
    try:
        return (paths.read_private_json(REGISTRY, folder, {}) or {}).get("plugins", [])
    finally:
        os.close(folder)


def save_registry(root, plugins: list[dict]) -> None:
    folder = plugin_dir(root)
    try:
        paths.write_private_json(REGISTRY, folder, {"plugins": plugins})
    finally:
        os.close(folder)


def find(root, name: str) -> dict:
    for plugin in registry(root):
        if plugin["name"] == name:
            return plugin
    raise BrowseError(f"No plugin named {name}; add one with `ardia browse plugin add <ref>`")


def run_tool(argv: list[str], timeout: float = 300) -> str:
    try:
        done = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, close_fds=True)
    except FileNotFoundError:
        raise BrowseError(f"{argv[0]} isn't installed") from None
    except subprocess.TimeoutExpired:
        raise BrowseError(f"{argv[0]} took longer than {timeout:g}s") from None
    if done.returncode:
        raise BrowseError(f"{' '.join(argv[:3])} failed: {done.stderr.decode(errors='replace').strip()[-400:]}")
    return done.stdout.decode(errors="replace")


def resolve_spec(ref: str) -> tuple[str, str, str]:
    github = GITHUB.match(ref)
    if github and not ref.startswith("@"):
        owner, repo, branch = github.groups()
        out = run_tool(["git", "ls-remote", f"https://github.com/{owner}/{repo}", branch or "HEAD"], 60)
        line = next((row for row in out.splitlines() if row.strip()), "")
        sha = line.split()[0] if line else ""
        if not re.fullmatch(r"[0-9a-f]{40}", sha):
            raise BrowseError(f"Couldn't resolve {ref} to a commit")
        return f"github:{owner}/{repo}#{sha}", repo, sha
    name, _, version = ref.rpartition("@") if ref.count("@") > (1 if ref.startswith("@") else 0) else (ref, "", "")
    if not NPM_NAME.match(name):
        raise Usage(f"{ref} isn't an npm package (name or name@version) or a GitHub owner/repo")
    if not version or not re.fullmatch(r"\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?", version):
        version = json.loads(run_tool(["npm", "view", f"{name}@{version or 'latest'}", "version", "--json"], 60))
        if isinstance(version, list):
            version = version[-1]
    return f"{name}@{version}", name, version


def add(root, ref: str, name: str | None, capabilities: list[str] | None) -> dict:
    spec, package, version = resolve_spec(ref)
    name = paths.check_name("A plugin name", name or package.split("/")[-1].removeprefix("agent-browser-plugin-"))
    plugins = [plugin for plugin in registry(root) if plugin["name"] != name]
    folder_fd = plugin_dir(root)
    os.close(folder_fd)
    base = Path(root) / paths.DIR_NAME / "plugins" / name
    if base.exists():
        shutil.rmtree(base)
    base.mkdir(mode=0o700)
    run_tool(["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund", "--no-save", "--prefix", str(base), spec], 600)
    manifest_dir = base / "node_modules" / (package if not spec.startswith("github:") else "")
    if spec.startswith("github:"):
        installed = [p for p in (base / "node_modules").iterdir() if (p / "package.json").is_file() and not p.name.startswith(".")]
        manifest_dir = installed[0] if installed else manifest_dir
    manifest = json.loads((manifest_dir / "package.json").read_text(encoding="utf-8"))
    bins = manifest.get("bin") or {}
    if isinstance(bins, str):
        bins = {manifest.get("name", package).split("/")[-1]: bins}
    if not bins:
        raise BrowseError(f"{spec} has no bin entry to run")
    command = (manifest_dir / next(iter(bins.values()))).resolve()
    if base.resolve() not in command.parents:
        raise BrowseError(f"{spec}'s bin points outside its install folder")
    declared = (manifest.get("agent-browser") or manifest.get("agentBrowser") or {}).get("capabilities") or []
    plugin = {"name": name, "package": manifest.get("name", package), "version": manifest.get("version", version), "spec": spec,
              "command": str(command), "capabilities": sorted(set(capabilities or declared or ["command.run"]))}
    plugins.append(plugin)
    save_registry(root, plugins)
    return plugin


def remove(root, name: str) -> None:
    find(root, name)
    save_registry(root, [plugin for plugin in registry(root) if plugin["name"] != name])
    base = Path(root) / paths.DIR_NAME / "plugins" / name
    if base.is_dir() and not base.is_symlink():
        shutil.rmtree(base)


def call(root, name: str, capability: str, request) -> object:
    plugin = find(root, name)
    if capability not in plugin["capabilities"] and capability != "command.run":
        raise BrowseError(f"Plugin {name} doesn't declare {capability} (it declares {', '.join(plugin['capabilities'])})")
    payload = json.dumps({"protocol": PROTOCOL, "capability": capability, "type": capability, "request": request})
    env = {key: value for key, value in os.environ.items() if not key.startswith(("ARDIA_", "AGENT_BROWSER_"))}
    try:
        done = subprocess.run([plugin["command"]], input=payload.encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              timeout=RUN_TIMEOUT, close_fds=True, env=env, cwd=str(Path(plugin["command"]).parent))
    except subprocess.TimeoutExpired:
        raise BrowseError(f"Plugin {name} didn't answer in {RUN_TIMEOUT}s") from None
    except OSError as error:
        raise BrowseError(f"Couldn't run plugin {name}: {error.strerror}") from None
    raw = done.stdout[:MAX_REPLY].decode(errors="replace").strip()
    try:
        reply = json.loads(raw.splitlines()[-1] if raw else "")
    except ValueError:
        raise BrowseError(f"Plugin '{name}' returned invalid JSON") from None
    if not isinstance(reply, dict) or reply.get("protocol") != PROTOCOL:
        raise BrowseError(f"Plugin '{name}' used unsupported protocol '{reply.get('protocol', '') if isinstance(reply, dict) else ''}'")
    if not reply.get("success"):
        raise BrowseError(f"Plugin '{name}' failed: {reply.get('error') or 'no detail'}")
    return reply.get("data")


def credential(root, name: str, item: str, url: str | None) -> dict:
    data = call(root, name, "credential.read", {"item": item, **({"url": url} if url else {})})
    if not isinstance(data, dict) or not data.get("password"):
        raise BrowseError(f"Plugin '{name}' returned no password for {item}")
    return data
