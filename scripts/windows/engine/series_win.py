#!/usr/bin/env python3
"""Our series on a Windows tree: the `chromium` lines of engine/patches/series, then those of
scripts/windows/engine/series-win (when it exists; its patches in scripts/windows/engine/patches,
and its `skip <patch>` lines leave a patch of engine/patches/series out), each applied strictly (git apply), else with patch's fuzz.
A patch that fails is recorded and the rest still run. Each patch that goes in is written to .series-win-applied beside
the tree and never applied again: a later patch on the same lines would hide it from a reverse check. Of the layers, engine/chromium runs as is (its
chrome/browser/ardia is only built into the Mac framework) and engine/ardiacore gives only the hook headers the
patches include. Writes a table: patch, result, which files it touches (Mac only, Mac and shared, OS-neutral).

Usage: series_win.py apply --report TSV | classify (CHROMIUM_SRC is the tree)
"""
import argparse
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
PATCHES = os.path.join(REPO, 'engine', 'patches')
WIN_PATCHES = os.path.join(HERE, 'patches')
HOOK_HEADERS = ['ardia/core/ac_hooks.h', 'ardia/core/ac_content_hooks.h']
MAC_FILE = re.compile(r'(\.mm$|_mac(_[a-z]+)?\.(cc|h)$|/mac/|cocoa|_apple\.(cc|h|mm)$|/apple/|keychain|\.icns$|\.car$)')


def chromium_lines(path):
    if not os.path.isfile(path):
        return []
    out = []
    for raw in open(path):
        line = raw.split('#', 1)[0].strip()
        if line.startswith('chromium '):
            out.append(line.split(None, 1)[1].strip())
    return out


def patch_files(path):
    files = []
    for line in open(path, encoding='utf-8', errors='surrogateescape'):
        m = re.match(r'^\+\+\+ (?:b/)?(\S+)', line)
        if m and m.group(1) != '/dev/null' and m.group(1) not in files:
            files.append(m.group(1))
    return files


def classify(files):
    mac = [f for f in files if MAC_FILE.search(f)]
    if not mac:
        return 'OS-neutral'
    return 'Mac only' if len(mac) == len(files) else 'Mac and shared'


def run(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)


def applied(path, tree):
    return run(['git', 'apply', '--check', '-R', path], tree).returncode == 0 or \
        run(['patch', '-p1', '--dry-run', '-R', '-s', '-f', '-i', path], tree).returncode == 0


def apply_one(path, tree):
    if applied(path, tree):
        return 'already applied', ''
    p = run(['git', 'apply', '--whitespace=nowarn', path], tree)
    if p.returncode == 0:
        return 'clean', ''
    strict_error = p.stderr.strip()
    p = run(['patch', '-p1', '--forward', '--dry-run', '-i', path], tree)
    if p.returncode != 0:
        detail = ' | '.join(l for l in (strict_error + '\n' + p.stdout + p.stderr).splitlines()
                            if re.search(r'fail|error|reject|does not|can\'t find', l, re.I))
        return 'FAILED', detail[:500]
    p = run(['patch', '-p1', '--forward', '--no-backup-if-mismatch', '-i', path], tree)
    if p.returncode != 0:
        return 'FAILED', (p.stdout + p.stderr).strip()[:500]
    how = [l.strip() for l in p.stdout.splitlines() if 'fuzz' in l or 'offset' in l]
    return 'with fuzz/offset', '; '.join(how)[:500]


def layers(tree):
    env = dict(os.environ, CHROMIUM_SRC=tree)
    p = subprocess.run([os.path.join(REPO, 'engine/chromium/apply.sh')], cwd=REPO, env=env,
                       capture_output=True, text=True)
    if p.returncode:
        sys.exit(f'engine/chromium/apply.sh failed: {p.stderr or p.stdout}')
    for rel in HOOK_HEADERS:
        dst = os.path.join(tree, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copyfile(os.path.join(REPO, 'engine/ardiacore/src', rel), dst)
    print(f'engine/chromium applied; {len(HOOK_HEADERS)} ArdiaCore hook headers copied')


def skipped():
    path = os.path.join(HERE, 'series-win')
    if not os.path.isfile(path):
        return set()
    return {l.split(None, 1)[1].strip() for l in (r.split('#', 1)[0].strip() for r in open(path))
            if l.startswith('skip ')}


def names():
    skips = skipped()
    return [(n, os.path.join(PATCHES, n)) for n in chromium_lines(os.path.join(PATCHES, 'series'))
            if n not in skips] + \
        [(n, os.path.join(WIN_PATCHES, n)) for n in chromium_lines(os.path.join(HERE, 'series-win'))]


def state_path(tree):
    return os.path.join(os.path.dirname(os.path.abspath(tree)), '.series-win-applied')


def read_state(tree):
    path = state_path(tree)
    return set(open(path).read().split()) if os.path.isfile(path) else set()


def record(tree, name):
    with open(state_path(tree), 'a') as f:
        f.write(name + '\n')


def cmd_apply(args):
    tree = os.environ['CHROMIUM_SRC']
    done = read_state(tree)
    rows, failed = [], 0
    for name in sorted(skipped()):
        rows.append((name, 'skipped (series-win)', classify(patch_files(os.path.join(PATCHES, name))), ''))
        print(f'{"skipped":16} {name}', flush=True)
    for name, path in names():
        if name in done:
            result, detail = 'already applied', 'recorded'
        else:
            result, detail = apply_one(path, tree)
            if result != 'FAILED':
                record(tree, name)
        failed += result == 'FAILED'
        rows.append((name, result, classify(patch_files(path)), detail))
        print(f'{result:16} {name}', flush=True)
    layers(tree)
    os.makedirs(os.path.dirname(args.report), exist_ok=True)
    with open(args.report, 'w') as f:
        f.write('patch\tresult\tfiles\tdetail\n')
        for row in rows:
            f.write('\t'.join(row) + '\n')
    skips = sum(1 for r in rows if r[1].startswith('skipped'))
    print(f'{len(rows) - failed - skips} of {len(rows) - skips} patches in, {skips} skipped; report: {args.report}')
    return 1 if failed else 0


def cmd_classify(args):
    for name, path in names():
        print(f'{classify(patch_files(path)):16} {name}')
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    apply = sub.add_parser('apply')
    apply.add_argument('--report', required=True)
    sub.add_parser('classify')
    args = parser.parse_args()
    return {'apply': cmd_apply, 'classify': cmd_classify}[args.command](args)


if __name__ == '__main__':
    sys.exit(main())
