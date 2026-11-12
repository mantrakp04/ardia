import os
import plistlib
import re
import stat
import sys
import tarfile

USAGE = "usage: python3 -I .github/release/unpack-build.py <build.tar> <new dir> <version>"

if len(sys.argv) != 4:
    sys.exit(USAGE)
tar_path, dest, version = sys.argv[1:]
VERSION_PATTERN = r"[0-9]+\.[0-9]+\.[0-9]+(-nightly\.[0-9]+)?"
if not re.fullmatch(VERSION_PATTERN, version):
    sys.exit(USAGE)

ARCHIVE = "Ardia.xcarchive"
APP = f"{ARCHIVE}/Products/Applications/Ardia.app"
CLI = f"ardia-cli-{version}-macos-arm64.tar.gz"
TOP_FILES = {"provenance.txt", CLI, f"{CLI}.sha256"}
ARCHIVE_DIRS = {ARCHIVE, f"{ARCHIVE}/Products", f"{ARCHIVE}/Products/Applications", f"{ARCHIVE}/dSYMs"}


def fail(message):
    sys.exit(f"error: the build artifact is refused: {message}")


def shown(name):
    return ascii(name)[:200]


def bundle_root(name):
    if name == APP or name.startswith(APP + "/"):
        return APP
    match = re.match(rf"^{re.escape(ARCHIVE)}/dSYMs/[A-Za-z0-9._-]+\.dSYM(?=/|$)", name)
    return match.group(0) if match else None


def inside(path, root):
    return path == root or path.startswith(root + "/")


def check_name(name):
    if not name or name.startswith("/") or len(name) > 1024:
        fail(f"member {shown(name)} has an absolute or empty path")
    if any(ord(c) < 32 or c == "\\" for c in name):
        fail(f"member {shown(name)} has a control character or backslash")
    parts = name.split("/")
    if any(part in ("", ".", "..") for part in parts):
        fail(f"member {shown(name)} has an empty, . or .. component")
    if name in TOP_FILES or name in ARCHIVE_DIRS or name == f"{ARCHIVE}/Info.plist" or bundle_root(name):
        return
    fail(f"member {shown(name)} isn't part of a build (the archive, provenance.txt, {CLI} and its .sha256)")


if os.path.lexists(dest):
    fail(f"{dest} already exists: unpack into a new directory")
with tarfile.open(tar_path, "r:") as tar:
    members = tar.getmembers()
    seen = set()
    links = {}
    for member in members:
        name = member.name
        check_name(name)
        if name in seen:
            fail(f"member {shown(name)} appears twice")
        seen.add(name)
        if member.isfile():
            if name in ARCHIVE_DIRS:
                fail(f"{shown(name)} must be a directory")
        elif member.isdir():
            if name in TOP_FILES or name == f"{ARCHIVE}/Info.plist":
                fail(f"{shown(name)} must be a file")
        elif member.issym():
            root = bundle_root(name)
            target = member.linkname
            if not root or name == root:
                fail(f"symlink {shown(name)} is outside an app or dSYM bundle")
            if not target or target.startswith("/") or any(ord(c) < 32 for c in target):
                fail(f"symlink {shown(name)} points at an absolute or empty path")
            resolved = os.path.normpath(os.path.join(os.path.dirname(name), target))
            if not inside(resolved, root):
                fail(f"symlink {shown(name)} points outside {root}")
            links[name] = target
        else:
            fail(f"member {shown(name)} is a hard link, device or fifo")
    for name in seen:
        parts = name.split("/")
        for depth in range(1, len(parts)):
            if "/".join(parts[:depth]) in links:
                fail(f"member {shown(name)} goes through the symlink {shown('/'.join(parts[:depth]))}")
    for required in (f"{APP}/Contents/Info.plist", *TOP_FILES):
        if required not in seen:
            fail(f"{required} is missing")

    os.makedirs(dest)
    real_dest = os.path.realpath(dest)

    def target_path(name):
        path = os.path.join(real_dest, name)
        parent = os.path.realpath(os.path.dirname(path))
        if not inside(parent, real_dest):
            fail(f"{shown(name)} would be written outside {dest}")
        return path

    for member in members:
        if member.isdir():
            os.makedirs(target_path(member.name), mode=0o755, exist_ok=True)
    for member in members:
        if not member.isfile():
            continue
        path = target_path(member.name)
        os.makedirs(os.path.dirname(path), mode=0o755, exist_ok=True)
        target_path(member.name)
        source = tar.extractfile(member)
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, "wb") as out:
            while True:
                chunk = source.read(1 << 20)
                if not chunk:
                    break
                out.write(chunk)
        os.chmod(path, 0o755 if member.mode & 0o111 else 0o644)
    for name, target in links.items():
        os.symlink(target, target_path(name))
    for name in links:
        if not inside(os.path.realpath(os.path.join(real_dest, name)), os.path.join(real_dest, bundle_root(name))):
            fail(f"symlink {shown(name)} resolves outside {bundle_root(name)}")

for path, _, files in os.walk(real_dest):
    for entry in files:
        mode = os.lstat(os.path.join(path, entry)).st_mode
        if not (stat.S_ISREG(mode) or stat.S_ISLNK(mode)):
            fail(f"{shown(os.path.join(path, entry))} isn't a file or symlink")

with open(os.path.join(real_dest, APP, "Contents/Info.plist"), "rb") as handle:
    try:
        info = plistlib.load(handle)
    except Exception:
        fail("the app's Info.plist isn't a property list")
expected = {"CFBundleIdentifier": "com.ardia.browser", "CFBundleExecutable": "Ardia", "CFBundleShortVersionString": version}
for key, value in expected.items():
    if info.get(key) != value:
        fail(f"the app's {key} isn't {value}")
with open(os.path.join(real_dest, f"{CLI}.sha256"), encoding="ascii", errors="replace") as handle:
    if not re.fullmatch(rf"[0-9a-f]{{64}}  {re.escape(CLI)}\n?", handle.read()):
        fail(f"{CLI}.sha256 isn't one SHA-256 line for {CLI}")
print(f"unpacked {len(members)} members into {dest}: Ardia.app {version} (com.ardia.browser), {CLI}")
