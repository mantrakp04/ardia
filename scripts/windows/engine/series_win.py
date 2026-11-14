#!/usr/bin/env python3
"""Our series on a Windows tree: the `chromium` lines of engine/patches/series, then those of
scripts/windows/engine/series-win (when it exists; its patches in scripts/windows/engine/patches,
and its `skip <patch>` lines leave a patch of engine/patches/series out), each applied strictly (git apply), else with patch's fuzz.
A patch that fails is recorded and the rest still run. Each patch that goes in is written to .series-win-applied beside
the tree and never applied again: a later patch on the same lines would hide it from a reverse check. Of the layers, engine/chromium runs as is (its
chrome/browser/ardia gets a Windows BUILD.gn made from the Mac one (no .mm, no pip/, no frameworks), the fixes in
ardia-layer-win.patch that make its sources build on Windows, and the files under src/chrome/browser/ardia in place of
the ones that are POSIX only), engine/ardiacore
gives the hook headers the patches include and ac_launch_switches (its Mac signature check answers no), and
scripts/windows/engine/src/ardia/win (the app in the browser process, with the app's EngineApi.h and a generated table
of the engine's ac_* calls) is copied to //ardia/win, only the files that changed. Writes a table: patch, result, which files it touches (Mac only, Mac and shared, OS-neutral).

Usage: series_win.py apply --report TSV | layer | classify (CHROMIUM_SRC is the tree)
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
PATCHES = os.path.join(REPO, 'engine', 'patches')
WIN_PATCHES = os.path.join(HERE, 'patches')
HOOK_HEADERS = ['ardia/core/ac_hooks.h', 'ardia/core/ac_content_hooks.h']
ARDIA_LAYER = os.path.join(REPO, 'engine/chromium/src/chrome/browser/ardia')
LAUNCH_SWITCHES = 'ardia/core/ac_launch_switches'
LAYER_PATCH = os.path.join(HERE, 'ardia-layer-win.patch')
LAYER_OVERLAY = os.path.join(HERE, 'src', 'chrome', 'browser', 'ardia')
MAC_LAYER_LINE = re.compile(r'(\.mm"|"pip/|"ac_external_apps\.h")')
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
    replaced = chromium_layer(tree)
    for rel in HOOK_HEADERS:
        dst = os.path.join(tree, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copyfile(os.path.join(REPO, 'engine/ardiacore/src', rel), dst)
    print(f'engine/chromium: {replaced} files changed; {len(HOOK_HEADERS)} ArdiaCore hook headers copied')
    win_layer(tree)


def copy_if_changed(source, target):
    data = open(source, 'rb').read()
    if os.path.isfile(target) and open(target, 'rb').read() == data:
        return 0
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, 'wb') as f:
        f.write(data)
    return 1


def files_under(root):
    found = {}
    for folder, _, files in os.walk(root):
        for name in files:
            if not name.startswith('.'):
                path = os.path.join(folder, name)
                found[os.path.relpath(path, root)] = path
    return found


def chromium_layer(tree):
    source_root = os.path.join(REPO, 'engine/chromium/src')
    owned = os.path.join('chrome', 'browser', 'ardia')
    changed = 0
    for rel, path in files_under(source_root).items():
        if rel == owned or rel.startswith(owned + os.sep):
            continue
        target = os.path.join(tree, rel)
        if not os.path.isfile(target):
            sys.exit(f'series_win.py: {rel} is not in the tree: engine/chromium/src replaces files, it adds none')
        changed += copy_if_changed(path, target)
    with tempfile.TemporaryDirectory() as scratch:
        work = os.path.join(scratch, 'ardia')
        shutil.copytree(ARDIA_LAYER, work)
        p = run(['patch', '-p1', '-F0', '-s', '--no-backup-if-mismatch', '-i', LAYER_PATCH], work)
        if p.returncode:
            sys.exit(f'series_win.py: {os.path.basename(LAYER_PATCH)} does not apply to engine/chromium: '
                     f'{(p.stdout + p.stderr).strip()[:600]}')
        for rel, path in files_under(LAYER_OVERLAY).items():
            shutil.copyfile(path, os.path.join(work, rel))
        with open(os.path.join(work, 'BUILD.gn'), 'w', encoding='utf-8') as f:
            f.write(ardia_build_file())
        wanted = files_under(work)
        target_root = os.path.join(tree, owned)
        for rel, path in wanted.items():
            changed += copy_if_changed(path, os.path.join(target_root, rel))
        for rel, path in files_under(target_root).items():
            if rel not in wanted:
                os.remove(path)
                changed += 1
    return changed


def write_if_changed(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.isfile(path) and open(path, encoding='utf-8').read() == text:
        return 0
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)
    return 1


def ardia_build_file():
    text = open(os.path.join(ARDIA_LAYER, 'BUILD.gn'), encoding='utf-8').read()
    if text.count('assert(is_mac)') != 1 or 'config("exports_config")' not in text:
        sys.exit('series_win.py: chrome/browser/ardia/BUILD.gn is not shaped as expected')
    text = text.replace('assert(is_mac)', 'assert(is_win)')
    text = ''.join(line for line in text.splitlines(True) if not MAC_LAYER_LINE.search(line))
    text = text.replace('    "//ardia/core:hooks",\n', '')
    text = text.replace('    "//ardia/core:launch_switches",\n', '    "//ardia/win:launch_switches",\n')
    text = re.sub(r'\n  frameworks \+?= \[[^\]]*\]\n', '\n', text)
    return text[:text.index('config("exports_config")')].rstrip() + '\n'


def launch_switches_source():
    text = open(os.path.join(REPO, 'engine/ardiacore/src', LAUNCH_SWITCHES + '.cc'), encoding='utf-8').read()
    signed = re.compile(r'bool SignedForDistribution\(\) \{\n.*?\n\}\n', re.S)
    mock = ('  if (!CommandLine().HasSwitch(os_crypt::switches::kUseMockKeychain)) {\n'
            '    return "not on the mock keychain";\n  }\n')
    native = 'return CommandLine().GetSwitchValueNative(name);'
    for needed in ('#include <Security/Security.h>\n\n', '#include "base/apple/scoped_cftyperef.h"\n', mock, native):
        if text.count(needed) != 1:
            sys.exit(f'series_win.py: {LAUNCH_SWITCHES}.cc has no {needed.strip()[:60]}')
    text = text.replace('#include <Security/Security.h>\n\n', '').replace('#include "base/apple/scoped_cftyperef.h"\n', '')
    text = text.replace(mock, '').replace(native, 'return CommandLine().GetSwitchValueUTF8(name);')
    if len(signed.findall(text)) != 1:
        sys.exit(f'series_win.py: {LAUNCH_SWITCHES}.cc has no SignedForDistribution')
    refusal = '    return "signed for distribution";\n'
    if text.count(refusal) != 1:
        sys.exit(f'series_win.py: {LAUNCH_SWITCHES}.cc has no signed-for-distribution refusal')
    text = text.replace(refusal, '    return "the engine\'s launch gate refused it (see ardia/win/test_gate.cc)";\n')
    return signed.sub('bool SignedForDistribution() {\n  return !CommandLine().HasSwitch("ardia-test-instance");\n}\n', text)


def engine_calls():
    names = set()
    for root, _, files in os.walk(ARDIA_LAYER):
        if os.path.basename(root) == 'pip':
            continue
        for name in files:
            if name.endswith('.cc'):
                text = open(os.path.join(root, name), encoding='utf-8').read()
                names.update(re.findall(r'^AC_(?:PROFILE|ARGS|ENGINE)_CALL\((ac_\w+)', text, re.M))
    return sorted(names)


def engine_calls_source(names):
    lines = ['#include "ardia/win/ac_calls.h"', '', 'extern "C" {']
    lines += [f'void {name}(const char*, const char*, ac_engine_reply_t, void*);' for name in names]
    lines += ['}', '', 'namespace ardia_win {', '', 'ac_engine_call_t FindEngineCall(std::string_view name) {',
              '  static constexpr struct {', '    std::string_view name;', '    ac_engine_call_t call;',
              '  } kCalls[] = {']
    lines += [f'      {{"{name}", &{name}}},' for name in names]
    lines += ['  };', '  for (const auto& entry : kCalls) {', '    if (entry.name == name) {',
              '      return entry.call;', '    }', '  }', '  return nullptr;', '}', '', '}', '']
    return '\n'.join(lines)


def win_layer(tree):
    source = os.path.join(HERE, 'src', 'ardia', 'win')
    target = os.path.join(tree, 'ardia', 'win')
    wanted = {}
    for root, _, files in os.walk(source):
        for name in files:
            path = os.path.join(root, name)
            wanted[os.path.relpath(path, source)] = path
    wanted[os.path.join('public', 'EngineApi.h')] = os.path.join(
        REPO, 'apps', 'browser', 'windows', 'Ardia', 'EngineApi.h')
    copied = 0
    for rel, path in wanted.items():
        dst = os.path.join(target, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if not os.path.isfile(dst) or open(dst, 'rb').read() != open(path, 'rb').read():
            shutil.copyfile(path, dst)
            copied += 1
    names = engine_calls()
    generated = {'ac_calls.cc': engine_calls_source(names)}
    for rel, text in generated.items():
        copied += write_if_changed(os.path.join(target, rel), text)
    for root, _, files in os.walk(target):
        for name in files:
            path = os.path.join(root, name)
            rel = os.path.relpath(path, target)
            if rel not in wanted and rel not in generated:
                os.remove(path)
    copied += write_if_changed(os.path.join(tree, LAUNCH_SWITCHES + '.cc'), launch_switches_source())
    shutil.copyfile(os.path.join(REPO, 'engine/ardiacore/src', LAUNCH_SWITCHES + '.h'),
                    os.path.join(tree, LAUNCH_SWITCHES + '.h'))
    print(f'ardia/win: {len(wanted) + len(generated)} files, {len(names)} engine calls, {copied} changed')


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


def cmd_layer(args):
    layers(os.environ['CHROMIUM_SRC'])
    return 0


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
    sub.add_parser('layer')
    args = parser.parse_args()
    return {'apply': cmd_apply, 'classify': cmd_classify, 'layer': cmd_layer}[args.command](args)


if __name__ == '__main__':
    sys.exit(main())
