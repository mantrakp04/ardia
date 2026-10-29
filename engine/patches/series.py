#!/usr/bin/env python3
"""Ardia's changes to the Chromium tree, in the order `series` gives.

  series.py apply [--phase chromium]             apply to the tree; skips what is already applied
  series.py check [--keep DIR]                   apply the whole series to a scratch copy of the base and
                                                 compare the result with the tree, byte for byte
  series.py capture-base [--phase chromium]      record the files the series touches as they are now (run
                                                 just before applying the series to a fresh or rebased tree)
  series.py materialize --until NAME DIR         the touched files as the series leaves them after NAME (to
                                                 remake a patch: edit there, diff against --until the line above)
  series.py files                                every path the series touches, by step

The base is the tree as Helium, its substitutions and resources (step 3) leave it, before any line of
`series`: ~/chromium-build/series-base (AC_SERIES_BASE), one file per touched path, relative to chromium/src.
`check` exits 0 when every step applies strictly (git apply: no fuzz) and the result equals the
tree; 1 with a report otherwise. It writes nothing outside its scratch directory.

Environment: CHROMIUM_SRC (default ~/chromium-build/chromium_git/chromium/src), AC_SERIES_BASE.
"""

import argparse
import filecmp
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "build"))
import pathguard  # noqa: E402
from target_config import configuration  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
SRC = os.environ.get("CHROMIUM_SRC", os.path.expanduser("~/chromium-build/chromium_git/chromium/src"))
BASE = None
TARGET_OS = None
TARGET_CPU = None


class Step:
    def __init__(self, kind, name, line):
        self.kind, self.name, self.line = kind, name, line

    def __repr__(self):
        return f"{self.kind} {self.name}"

    @property
    def patch(self):
        return os.path.join(HERE, self.name)

    def created(self):
        if self.kind != "chromium":
            return set()
        out, new = set(), False
        for line in pathlib.Path(self.patch).read_text(encoding="utf-8", errors="surrogateescape").splitlines():
            if line.startswith("--- "):
                new = line.strip() == "--- /dev/null"
            m = re.match(r"^\+\+\+ (?:b/)?(\S+)", line)
            if m and new:
                out.add(m.group(1))
        return out

    def paths(self):
        if self.kind == "chromium":
            out = []
            for line in pathlib.Path(self.patch).read_text(encoding="utf-8", errors="surrogateescape").splitlines():
                m = re.match(r"^\+\+\+ (?:b/)?(\S+)", line)
                if m and m.group(1) != "/dev/null":
                    out.append((m.group(1), False))
            return dedupe(out)
        return layer_paths(os.path.join(REPO, self.name))


def dedupe(items):
    seen, out = set(), []
    for item in items:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


def layer_paths(layer):
    script = pathlib.Path(layer, "apply.sh").read_text()
    out = []
    m = re.search(r"^owned=\(([^)]*)\)", script, re.M)
    dirs = m.group(1).split() if m else []
    if re.search(r"--paths\s*\)", script):
        result = subprocess.run([os.path.join(layer, "apply.sh"), "--paths"], capture_output=True, text=True)
        if result.returncode:
            sys.exit(f"{layer}/apply.sh --paths: {result.stderr or result.stdout}")
        for entry in result.stdout.splitlines():
            if not entry or os.path.isabs(entry) or ".." in entry.split("/"):
                sys.exit(f"{layer}/apply.sh --paths: invalid path {entry!r}")
            if entry.endswith("/"):
                dirs.append(entry.rstrip("/"))
            else:
                out.append((entry, False))
    else:
        for path in re.findall(r'"\$src/([A-Za-z0-9_./-]+)"', script):
            path = path.rstrip("/")
            if os.path.isdir(os.path.join(layer, "src", path)):
                dirs.append(path)
            else:
                out.append((path, False))
    root = os.path.join(layer, "src")
    for top, subdirs, files in os.walk(root):
        rel = os.path.relpath(top, root)
        subdirs[:] = sorted(d for d in subdirs if os.path.normpath(os.path.join(rel, d)) not in dirs)
        out.extend((os.path.normpath(os.path.join(rel, f)), False) for f in sorted(files) if not f.startswith("."))
    return dedupe([(d, True) for d in dirs] + out)


def read_series(platform=None):
    platform = platform or TARGET_OS or configuration()['AC_TARGET_OS']
    steps, listed = [], []
    for n, raw in enumerate(pathlib.Path(HERE, "series").read_text().splitlines(), 1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        fields = line.split()
        if len(fields) not in (2, 3) or fields[0] not in ("chromium", "layer"):
            sys.exit(f"series:{n}: expected `chromium|layer <name> [all|mac|linux]`: {raw.rstrip()}")
        kind, name = fields[:2]
        selector = fields[2] if len(fields) == 3 else "all"
        if selector not in ("all", "mac", "linux"):
            sys.exit(f"series:{n}: unknown platform {selector}")
        if os.path.isabs(name) or ".." in name.split("/"):
            sys.exit(f"series:{n}: name must stay inside the repository: {name}")
        if kind == "chromium":
            listed.append(name)
        step = Step(kind, name, n)
        if kind != "layer" and not os.path.isfile(step.patch):
            sys.exit(f"series:{n}: no such patch {name}")
        if selector not in ("all", platform):
            continue
        if kind == "layer" and not os.path.isfile(os.path.join(REPO, name, "apply.sh")):
            sys.exit(f"series:{n}: no {name}/apply.sh")
        steps.append(step)
    if len(listed) != len(set(listed)):
        sys.exit("series: duplicate patch entries")
    unlisted = sorted(set(f for f in os.listdir(HERE) if f.endswith(".patch")) - set(listed))
    if unlisted:
        sys.exit("patches missing from series: " + ", ".join(unlisted))
    return steps


def run(cmd, cwd, env=None, check=False):
    p = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True)
    if check and p.returncode:
        sys.exit(f"{' '.join(cmd)} (in {cwd}): {p.stderr or p.stdout}")
    return p


def apply_step(step, tree, strict=True):
    if step.kind == "layer":
        env = dict(os.environ, CHROMIUM_SRC=tree)
        p = run([os.path.join(REPO, step.name, "apply.sh")], REPO, env)
        return None if p.returncode == 0 else (p.stderr or p.stdout).strip()
    cwd = tree
    p = run(["git", "apply", "--whitespace=nowarn", step.patch], cwd)
    if p.returncode == 0:
        return None
    if strict:
        return p.stderr.strip()
    p = run(["patch", "-p1", "--forward", "--dry-run", "-s", "-i", step.patch], cwd)
    if p.returncode != 0:
        return (p.stdout + p.stderr).strip()
    p = run(["patch", "-p1", "--forward", "-s", "-i", step.patch], cwd)
    return None if p.returncode == 0 else (p.stdout + p.stderr).strip()


def is_applied(step, tree):
    if step.kind == "layer":
        p = run([os.path.join(REPO, step.name, "apply.sh"), "--check"], REPO, dict(os.environ, CHROMIUM_SRC=tree))
        return p.returncode == 0
    cwd = tree
    return run(["git", "apply", "--check", "-R", step.patch], cwd).returncode == 0 or \
        run(["patch", "-p1", "--dry-run", "-R", "-s", "-f", "-i", step.patch], cwd).returncode == 0


def phase_of(step):
    return "chromium"


def touched(steps):
    out = []
    for step in steps:
        out.extend(step.paths())
    return dedupe(out)


def copy_path(src_root, dst_root, path, is_dir, missing_ok=True):
    src, dst = os.path.join(src_root, path), os.path.join(dst_root, path)
    if is_dir:
        if os.path.isdir(src):
            shutil.copytree(src, dst, symlinks=True, dirs_exist_ok=True)
        return
    if not os.path.exists(src):
        if missing_ok:
            return
        sys.exit(f"missing {src}")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if os.path.lexists(dst):
        os.unlink(dst)
    shutil.copy2(src, dst, follow_symlinks=False)


def base_from_git(path, out):
    p = subprocess.run(["git", "show", f"HEAD:{path}"], cwd=SRC, capture_output=True)
    if p.returncode:
        return False
    os.makedirs(os.path.dirname(os.path.join(out, path)), exist_ok=True)
    if os.path.lexists(os.path.join(out, path)):
        os.unlink(os.path.join(out, path))
    open(os.path.join(out, path), "wb").write(p.stdout)
    return True




def cmd_files(args):
    for step in read_series():
        print(f"{step}:")
        for path, is_dir in step.paths():
            print(f"  {path}{'/' if is_dir else ''}")


def cmd_apply(args):
    steps = [s for s in read_series() if not args.phase or phase_of(s) == args.phase]
    final_applied = set()
    if TARGET_OS == "linux" and os.path.isfile(os.path.join(BASE, '.ardia-series-target')):
        with tempfile.TemporaryDirectory(prefix="ac-linux-applied-") as scratch:
            errors = materialize(steps, scratch)
            if errors:
                sys.exit("\n".join(errors))
            for step in steps:
                if step.kind != "chromium":
                    continue
                text = pathlib.Path(step.patch).read_text(encoding="utf-8", errors="surrogateescape")
                if re.search(r"^(?:\+\+\+ /dev/null(?:\s|$)|(?:rename|copy) (?:from|to) )", text, re.M):
                    continue
                paths = step.paths()
                if paths and all(
                    os.path.isfile(os.path.join(scratch, path)) and
                    os.path.isfile(os.path.join(SRC, path)) and
                    filecmp.cmp(os.path.join(scratch, path), os.path.join(SRC, path), shallow=False)
                    for path, is_dir in paths if not is_dir
                ):
                    final_applied.add(step.name)
    for step in steps:
        if step.kind != "layer" and (step.name in final_applied or is_applied(step, SRC)):
            print(f"already applied {step.name}")
            continue
        error = apply_step(step, SRC, strict=False)
        if error:
            sys.exit(f"error: {step} does not apply:\n{error}")
        print(f"applied {step}")
    run([os.path.join(HERE, "build", "game-resource.sh"), "--apply"], HERE, env=dict(os.environ, CHROMIUM_SRC=SRC), check=True)


def cmd_capture_base(args):
    steps = [s for s in read_series() if not args.phase or phase_of(s) == args.phase]
    created = set().union(*(s.created() for s in steps))
    os.makedirs(BASE, exist_ok=True)
    pathlib.Path(BASE, '.ardia-series-target').write_text(json.dumps({'platform': TARGET_OS, 'cpu': TARGET_CPU}, sort_keys=True) + '\n')
    count = 0
    for path, is_dir in touched(steps):
        if is_dir or path in created:
            continue
        if os.path.exists(os.path.join(BASE, path)) and not args.force:
            continue
        copy_path(SRC, BASE, path, False)
        count += 1
    print(f"captured {count} files into {BASE}")


def materialize(steps, out, until=None, report=None):
    paths = touched(steps)
    for path, is_dir in paths:
        if is_dir:
            continue
        if os.path.exists(os.path.join(BASE, path)):
            copy_path(BASE, out, path, False)
        elif base_from_git(path, out):
            print(f"note: {path} isn't in the base; using the checkout's git HEAD (capture-base it before hooking it)")
    errors = []
    for step in steps:
        error = apply_step(step, out, strict=True)
        if error:
            errors.append(f"{step} (series:{step.line}) does not apply cleanly:\n    " + error.replace("\n", "\n    "))
            apply_step(step, out, strict=False)
        elif report:
            report(f"ok  {step}")
        if until and step.name == until:
            break
    return errors


def cmd_materialize(args):
    steps = read_series()
    if args.until not in [s.name for s in steps]:
        sys.exit(f"{args.until} isn't in series")
    os.makedirs(args.dir, exist_ok=True)
    errors = materialize(steps, args.dir, until=args.until)
    print("\n".join(errors) or f"{args.dir}: the touched files after {args.until}")
    return 1 if errors else 0


def cmd_check(args):
    if not os.path.isdir(BASE):
        sys.exit(f"no base at {BASE}: run `series.py capture-base` on a tree before its series is applied")
    steps = read_series()
    scratch = args.keep or tempfile.mkdtemp(prefix="ac-series-")
    os.makedirs(scratch, exist_ok=True)
    try:
        errors = materialize(steps, scratch, report=print if args.verbose else None)
        differ = []
        for path, is_dir in touched(steps):
            a, b = os.path.join(scratch, path), os.path.join(SRC, path)
            if is_dir:
                cmp = filecmp.dircmp(a, b) if os.path.isdir(a) and os.path.isdir(b) else None
                if cmp is None or tree_differs(cmp):
                    differ.append(path + "/")
            elif os.path.exists(a) != os.path.exists(b) or (os.path.exists(a) and not filecmp.cmp(a, b, shallow=False)):
                differ.append(path)
        for path in differ:
            errors.append(f"{path}: the series doesn't reproduce the tree's file"
                          f"\n    diff -u {os.path.join(scratch, path)} {os.path.join(SRC, path)}")
        files = sum(1 for p, d in touched(steps))
        if errors:
            print("\n".join(errors))
            print(f"FAIL: {len(steps)} steps, {files} paths, {len(errors)} problems (scratch kept: {scratch})")
            args.keep = scratch
            return 1
        print(f"OK: {len(steps)} steps apply in order to the base and reproduce the tree's {files} touched paths")
        return 0
    finally:
        if not args.keep:
            shutil.rmtree(scratch, ignore_errors=True)


def tree_differs(cmp):
    if cmp.left_only or cmp.right_only or cmp.funny_files:
        return True
    _, mismatch, errors = filecmp.cmpfiles(cmp.left, cmp.right, cmp.common_files, shallow=False)
    if mismatch or errors:
        return True
    return any(tree_differs(sub) for sub in cmp.subdirs.values())


def holds_lock_for(path):
    if pathguard.reaches(path):
        return pathguard.real_lock_held()
    return pathguard.chromium_lock_held()


def real_chromium_build():
    return pathguard.real_chromium_build()


def live_tree():
    return os.path.realpath(os.path.join(real_chromium_build(), "chromium_git/chromium/src"))


def written_rels():
    return [path for path, _ in touched(read_series())]


def guard_writes(args):
    if args.command == "apply":
        pathguard.require_tree_writable(SRC, written_rels(), "series.py apply")
    elif args.command == "capture-base":
        pathguard.require_tree_writable(BASE, written_rels() + [".ardia-series-target"], "series.py capture-base")
    elif args.command == "check" and args.keep:
        if os.path.lexists(args.keep) and os.listdir(args.keep):
            sys.exit(f"series.py: --keep {args.keep} isn't empty: give it a new directory")
        for tree in (SRC, BASE):
            if pathguard.overlaps(args.keep, tree):
                sys.exit(f"series.py: {args.keep} overlaps {tree}: write the scratch copy somewhere else")
        pathguard.require_scratch_destination(args.keep, "series.py check --keep")
    elif args.command == "materialize":
        if os.path.lexists(args.dir) and os.listdir(args.dir):
            sys.exit(f"series.py: {args.dir} isn't empty: give materialize a new directory")
        for tree in (SRC, BASE):
            if pathguard.overlaps(args.dir, tree):
                sys.exit(f"series.py: {args.dir} overlaps {tree}: write the scratch copy somewhere else")
        pathguard.require_scratch_destination(args.dir, "series.py materialize")


def refuse_live_base_for_scratch_tree():
    if os.path.realpath(SRC) != live_tree() and "AC_SERIES_BASE" not in os.environ and "AC_CHROMIUM_BUILD" not in os.environ:
        sys.exit(f"CHROMIUM_SRC is {SRC}, not the live tree: set AC_SERIES_BASE too, so its base isn't "
                 f"~/chromium-build/series-base")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("apply")
    p.add_argument("--phase", choices=["chromium"])
    p = sub.add_parser("check")
    p.add_argument("--keep", metavar="DIR", help="scratch directory to keep")
    p.add_argument("-v", "--verbose", action="store_true")
    p = sub.add_parser("capture-base")
    p.add_argument("--phase", choices=["chromium"])
    p.add_argument("--force", action="store_true", help="replace files already captured")
    p = sub.add_parser("materialize")
    p.add_argument("--until", required=True)
    p.add_argument("dir")
    sub.add_parser("files")
    for command_parser in sub.choices.values():
        command_parser.add_argument("--platform", choices=("mac", "linux"))
        command_parser.add_argument("--cpu", choices=("arm64", "x64"))
    args = parser.parse_args()
    global BASE, TARGET_OS, TARGET_CPU, SRC
    try:
        target = configuration(args.platform, args.cpu)
    except ValueError as error:
        parser.error(str(error))
    TARGET_OS = target['AC_TARGET_OS']
    TARGET_CPU = target['AC_TARGET_CPU']
    os.environ.update(target)
    cb = os.environ.get("AC_CHROMIUM_BUILD", os.path.expanduser("~/chromium-build"))
    if TARGET_OS == "linux" and "CHROMIUM_SRC" not in os.environ:
        SRC = os.path.join(cb, "chromium_git/chromium/src")
    base_name = "series-base" if (TARGET_OS, target['AC_TARGET_CPU']) == ("mac", "arm64") else f"series-base-{TARGET_OS}-{target['AC_TARGET_CPU']}"
    BASE = os.environ.get("AC_SERIES_BASE", os.path.join(cb, base_name))
    if args.command in ("check", "capture-base", "materialize"):
        refuse_live_base_for_scratch_tree()
    guard_writes(args)
    if args.command in ("check", "capture-base", "materialize") or (args.command == "apply" and TARGET_OS == "linux"):
        marker = pathlib.Path(BASE, '.ardia-series-target')
        if marker.exists():
            try:
                recorded = json.loads(marker.read_text())
            except (ValueError, OSError) as error:
                parser.error(f'{marker}: invalid base identity: {error}')
            if recorded != {'platform': TARGET_OS, 'cpu': TARGET_CPU}:
                parser.error(f'{BASE} belongs to {recorded}; use a separate base for {TARGET_OS}/{TARGET_CPU}')
    handler = {"apply": cmd_apply, "check": cmd_check, "capture-base": cmd_capture_base,
               "materialize": cmd_materialize, "files": cmd_files}[args.command]
    sys.exit(handler(args) or 0)


if __name__ == "__main__":
    main()
