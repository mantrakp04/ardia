#!/usr/bin/env python3
"""Step 3: turn a Chromium $CHROMIUM_VERSION tree into Helium's, as Ardia takes it, ready for our series (step 4).

Helium is helium-chromium $HELIUM_TAG plus helium-macos $HELIUM_MACOS_TAG (helium-pins.ini pins both by commit).
Helium's downloads (its uBlock Origin, the onboarding page, the non-free search engine data) stay out of Ardia
entirely: no stage fetches them, and the hunks of Helium's patches that edit them are left out. Stages, in order:

  pins           the Helium checkouts are at the pinned commits, unmodified, made for this Chromium; deps.ini
                 downloads nothing Ardia doesn't omit
  guard          every skipped patch is still in Helium's series, and no applied patch's added lines touch what a
                 skip protects (Safe Storage, passwords, Sparkle, the product dir, mDNS) beyond the reviewed allowlist
  patches        helium-chromium's series, then helium-macos's, minus SKIP and minus the omitted downloads' files;
                 patch -p1 -l -N with no fuzz (Helium allows 2; a patch that needs it fails here instead)
  fixups         saving passwords, addresses and cards on by default
  domsub         Helium's domain substitution, minus domsub-keep-store.txt (the Web Store and extension updates)
  namesub        Helium's name_substitution.py --sub and i18n_apply.py
  brand-namesub  ardia_namesub.py: Helium -> Ardia in the string files
  version        HELIUM_* in chrome/VERSION, equal to Chromium's own version, so Helium's version is never shown
  resources      Helium's icons (its generated ones made with sips), then ardia_resources.txt over them

Run once on a fresh tree (step 1), then step 4. The changing stages run once per tree: a record beside the tree
(.helium-stages-<dir>) refuses a second run, and a run that died mid-stage. The live tree needs --apply and the
chromium lock.

Usage: 03-helium.py [--tree SRC] [--apply] [--only STAGE,…] [--from STAGE] [--no-brand] [--guard-extra PATCH]…
"""
import argparse
import configparser
import fnmatch
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pathguard  # noqa: E402

HERE = pathlib.Path(__file__).resolve().parent
CB = pathlib.Path(os.environ.get('AC_CHROMIUM_BUILD') or pathlib.Path.home() / 'chromium-build')
PATCH = '/usr/bin/patch'
REPO = pathlib.Path(os.environ.get('AC_REPO') or HERE.parent.parent.parent)

SKIP = {
    'helium/core/disable-password-manager.patch':
        'forces password saving and passkeys off as managed prefs; Ardia uses Chrome\'s password manager',
    'helium/ui/remove-autofill-link-to-password-manager.patch': 'drops "Manage passwords" from the fill dropdown',
    'ungoogled-chromium/fix-building-without-mdns-and-service-discovery.patch':
        'empties DnsSdDeviceLister; the Cast dialog needs mDNS (enable_mdns stays true)',
    'helium/macos/change-keychain-name.patch':
        'renames the Safe Storage item; every user\'s passwords and cookies are encrypted with "Ardia Safe Storage"',
    'helium/macos/change-product-dir-name.patch': 'moves the fallback product dir to net.imput.helium',
    'rebel/macos/sparkle-integration.patch': 'Sparkle inside the framework; the app has its own updater',
    'helium/macos/updater/fixup-sparkle-glue.patch': 'Sparkle inside the framework',
    'helium/macos/updater/sparkle2-integration.patch': 'Sparkle inside the framework',
    'helium/macos/updater/disable-default-updater.patch': 'Sparkle inside the framework',
    'helium/ui/crash-dialog.patch': 'a startup infobar asking to upload crashes to crash.helium.computer',
    'helium/core/use-system-python3.patch': 'Helium\'s build setup: .gn script_executable (reruns every action)',
    'helium/core/rbe-nativelink-config.patch': 'Helium\'s remote build setup',
    'helium/macos/rbe-linux-clang-wrapper.patch': 'Helium\'s remote build setup',
    'helium/macos/chromium-signing.patch': 'Helium\'s signing flow; scripts/release.sh signs Ardia',
}

GUARD_MARKERS = [
    ('keychain_password_mac.mm', False), ('Safe Storage', False), ('Storage Key', False),
    ('kCredentialsEnableService', False), ('kCredentialsEnablePasskeys', False),
    ('DisabledPasswordManagerPolicyHandler', False), ('password_suggestion_generator.cc', False),
    ('sparkle', True), ('feedURL', False),
    ('chrome_paths_mac.mm', False), ('net.imput.helium', False),
    ('dns_sd_', False), ('service_discovery', False), ('enable_mdns', False),
]

GUARD_ALLOWED = {
    ('inox-patchset/modify-default-prefs.patch', 'kCredentialsEnableService',
     '+      prefs::kCredentialsEnableService, false,'),
    ('helium/core/change-chromium-branding.patch', 'net.imput.helium', '+MAC_BUNDLE_ID=net.imput.helium'),
    ('helium/core/scan-chrome-native-messaging-hosts.patch', 'chrome_paths_mac.mm',
     '+++ b/chrome/common/chrome_paths_mac.mm'),
    ('helium/macos/prevent-reset-on-keychain-unavailability.patch', 'keychain_password_mac.mm',
     '+++ b/components/os_crypt/common/keychain_password_mac.mm'),
}

FIXUPS = [
    ('components/password_manager/core/browser/password_manager.cc',
     '      prefs::kCredentialsEnableService, false,', '      prefs::kCredentialsEnableService, true,'),
    ('components/autofill/core/common/autofill_prefs.cc',
     '      kAutofillProfileEnabled, false,', '      kAutofillProfileEnabled, true,'),
    ('components/autofill/core/common/autofill_prefs.cc',
     '      kAutofillCreditCardEnabled, false,', '      kAutofillCreditCardEnabled, true,'),
]

OMITTED = ('third_party/ublock/', 'components/helium_onboarding/', 'third_party/search_engines_data/resources_internal/')

STAGES = ['pins', 'guard', 'patches', 'fixups', 'domsub', 'namesub', 'brand-namesub', 'version', 'resources']
MUTATING = {'patches', 'fixups', 'domsub', 'namesub', 'brand-namesub', 'version', 'resources'}


class StageError(Exception):
    pass


def pins():
    config = configparser.ConfigParser(interpolation=None)
    config.read(HERE / 'helium-pins.ini')
    return config


def series(repo):
    for line in (repo / 'patches/series').read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#'):
            yield line


def helium_patches(ctx):
    for repo, tag in ((ctx.hc, 'helium-chromium'), (ctx.hm, 'helium-macos')):
        for name in series(repo):
            yield tag, name, repo / 'patches' / name


def git(repo, *args):
    return subprocess.run(['git', '--no-optional-locks', '-C', str(repo), *args], capture_output=True, text=True)


def stage_pins(ctx):
    config = pins()
    problems = []
    for section, repo in (('helium-chromium', ctx.hc), ('helium-macos', ctx.hm)):
        want = config[section]['commit']
        head = git(repo, 'rev-parse', 'HEAD').stdout.strip()
        if head != want:
            problems.append(f'{repo} is at {head or "no checkout"}, not {section} {config[section]["tag"]} ({want})')
        dirty = git(repo, 'status', '--porcelain', '--untracked-files=no').stdout.strip()
        if dirty:
            problems.append(f'{repo} has local changes:\n{dirty}')
    chromium = config['chromium']['version']
    if os.environ.get('CHROMIUM_VERSION', chromium) != chromium:
        problems.append(f'env.sh CHROMIUM_VERSION {os.environ["CHROMIUM_VERSION"]} != helium-pins.ini {chromium}')
    helium_chromium = (ctx.hc / 'chromium_version.txt').read_text().strip()
    if helium_chromium != chromium:
        problems.append(f'Helium {config["helium-chromium"]["tag"]} is made for Chromium {helium_chromium}')
    version_file = ctx.tree / 'chrome/VERSION'
    if version_file.exists():
        parts = dict(l.split('=', 1) for l in version_file.read_text().split() if '=' in l)
        tree_version = '.'.join(parts.get(k, '?') for k in ('MAJOR', 'MINOR', 'BUILD', 'PATCH'))
        if tree_version != chromium:
            problems.append(f'the tree is Chromium {tree_version}, not {chromium}')
    deps = configparser.ConfigParser(interpolation=None)
    deps.read(ctx.hc / 'deps.ini')
    for section in deps.sections():
        out = deps[section].get('output_path', '').lstrip('./').rstrip('/') + '/'
        if not out.startswith(OMITTED):
            problems.append(f'deps.ini [{section}] downloads into {out}, which Ardia doesn\'t omit: decide on it')
    if problems:
        raise StageError('\n'.join(problems))
    print(f'Helium {config["helium-chromium"]["tag"]} / macOS {config["helium-macos"]["tag"]} on Chromium {chromium}')


def guard_hits(name, path):
    target = None
    for raw in open(path, encoding='utf-8', errors='replace'):
        line = raw.rstrip('\n')
        m = re.match(r'^\+\+\+ (?:b/)?(\S+)', line)
        if m:
            target = m.group(1)
        if not line.startswith('+'):
            continue
        for marker, any_case in GUARD_MARKERS:
            if (marker.lower() in line.lower()) if any_case else (marker in line):
                yield name, marker, line, target


def stage_guard(ctx):
    problems = []
    names = {name for _, name, _ in helium_patches(ctx)}
    for name in SKIP:
        if name not in names:
            problems.append(f'skipped {name} is no longer in Helium\'s series: re-check what replaced it')
    candidates = [(name, path) for _, name, path in helium_patches(ctx) if name not in SKIP]
    candidates += [(f'extra:{p}', pathlib.Path(p)) for p in ctx.guard_extra]
    seen = set()
    for name, path in candidates:
        for name, marker, line, target in guard_hits(name, path):
            key = (name, marker, line)
            seen.add(key)
            if key not in GUARD_ALLOWED:
                problems.append(f'{name} ({target}) touches what a skip protects [{marker}]: {line[:160]}')
    for key in sorted(GUARD_ALLOWED - seen):
        problems.append(f'allowlisted guard hit is gone (re-review and update GUARD_ALLOWED): {key}')
    if problems:
        raise StageError('\n'.join(problems))
    print(f'{len(SKIP)} skips guarded; {len(candidates)} applied patches checked, '
          f'{len(GUARD_ALLOWED)} allowlisted hits')


def file_sections(text):
    lines = text.splitlines(keepends=True)
    head, sections, i = [], [], 0
    current = None
    while i < len(lines):
        line = lines[i]
        if line.startswith('--- ') and i + 1 < len(lines) and lines[i + 1].startswith('+++ '):
            target = lines[i + 1][4:].split('\t')[0].strip()
            target = target[2:] if target.startswith('b/') else target
            if target == '/dev/null':
                target = line[4:].split('\t')[0].strip().removeprefix('a/')
            current = [target, [line, lines[i + 1]]]
            sections.append(current)
            i += 2
            continue
        m = re.match(r'^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@', line)
        if m and current is not None:
            old = int(m.group(1) if m.group(1) is not None else 1)
            new = int(m.group(2) if m.group(2) is not None else 1)
            current[1].append(line)
            i += 1
            while (old > 0 or new > 0) and i < len(lines):
                body = lines[i]
                current[1].append(body)
                if body.startswith('\\'):
                    i += 1
                    continue
                if body.startswith('-'):
                    old -= 1
                elif body.startswith('+'):
                    new -= 1
                else:
                    old -= 1
                    new -= 1
                i += 1
            while i < len(lines) and lines[i].startswith('\\'):
                current[1].append(lines[i])
                i += 1
            continue
        (current[1] if current is not None else head).append(line)
        i += 1
    return head, sections


def without_omitted(ctx, name, path):
    text = path.read_text(errors='surrogateescape')
    head, sections = file_sections(text)
    dropped = [t for t, _ in sections if t.startswith(OMITTED)]
    if not dropped:
        return path, []
    kept = ''.join(head) + ''.join(''.join(body) for t, body in sections if not t.startswith(OMITTED))
    out = ctx.work / 'partial' / name
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(kept, errors='surrogateescape')
    return out, dropped


def touched_files(path):
    out = set()
    for line in open(path, encoding='utf-8', errors='replace'):
        m = re.match(r'^(?:\+\+\+|---) (?:[ab]/)?(\S+)', line)
        if m and m.group(1) != '/dev/null':
            out.add(m.group(1))
    return out


def run_patch(ctx, path, dry):
    cmd = [PATCH, '-p1', '-l', '-N', '-F0', '-V', 'none', '--no-backup-if-mismatch', '-d', str(ctx.tree),
           '-i', str(path)]
    if dry:
        cmd.insert(1, '--dry-run')
    return subprocess.run(cmd, capture_output=True, text=True)


def write_report(ctx, rows):
    ctx.report.parent.mkdir(parents=True, exist_ok=True)
    ctx.report.write_text('repo\tpatch\tstatus\tdetail\n' + ''.join('\t'.join(r) + '\n' for r in rows))


def stage_patches(ctx):
    rows, applied = [], 0
    skipped = {name: path for _, name, path in helium_patches(ctx) if name in SKIP}
    for tag, name, path in helium_patches(ctx):
        if name in SKIP:
            rows.append((tag, name, 'skipped', SKIP[name]))
            continue
        path, dropped = without_omitted(ctx, name, path)
        p = run_patch(ctx, path, dry=True)
        if p.returncode:
            mine = touched_files(path)
            near = [s for s, sp in skipped.items() if mine & touched_files(sp)]
            detail = ' | '.join(l for l in (p.stdout + p.stderr).splitlines()
                                if re.search(r'fail|reject|ignored|reversed|can\'t find', l, re.I))[:600]
            write_report(ctx, rows + [(tag, name, 'FAILED', detail)])
            hint = (f'\n  it shares files with skipped {", ".join(near)}: a skip may have stopped being a leaf'
                    if near else '')
            raise StageError(f'{tag} {name} does not apply: {detail}{hint}')
        p = run_patch(ctx, path, dry=False)
        if p.returncode:
            raise StageError(f'{tag} {name} failed after a clean dry run:\n{p.stdout}{p.stderr}')
        how = 'offset' if 'offset' in p.stdout else 'exact'
        if dropped:
            how += '; without ' + ', '.join(dropped)
        rows.append((tag, name, 'partial' if dropped else 'applied', how))
        applied += 1
    write_report(ctx, rows)
    partial = [r[1] for r in rows if r[2] == 'partial']
    leftovers = [d for d in OMITTED if (ctx.tree / d).is_file() or (ctx.tree / d).is_dir() and any((ctx.tree / d).iterdir())]
    if leftovers:
        raise StageError(f'omitted downloads are in the tree: {", ".join(leftovers)}')
    print(f'applied {applied} with no fuzz, skipped {len(skipped)}; '
          f'without the omitted downloads\' files: {", ".join(partial) or "none"}')


def stage_fixups(ctx):
    for rel, old, new in FIXUPS:
        f = ctx.tree / rel
        s = f.read_text()
        if new in s:
            continue
        if s.count(old) != 1:
            raise StageError(f'fixup anchor {old.strip()!r} is not in {rel} exactly once')
        f.write_text(s.replace(old, new, 1))
    print(f'{len(FIXUPS)} default prefs turned back on')


def keep_patterns():
    return [l.strip() for l in (HERE / 'domsub-keep-store.txt').read_text().splitlines()
            if l.strip() and not l.startswith('#')]


def stage_domsub(ctx):
    if ctx.domsub_cache.exists():
        raise StageError(f'{ctx.domsub_cache} exists: the tree is already substituted')
    keep = keep_patterns()
    listed = (ctx.hc / 'domain_substitution.list').read_text().splitlines()
    unused = [p for p in keep if not any(fnmatch.fnmatch(path, p) for path in listed)]
    kept = {path for path in listed if path and any(fnmatch.fnmatch(path, p) for p in keep)}
    filtered = [path for path in listed if path and path not in kept]
    ctx.work.mkdir(parents=True, exist_ok=True)
    flist = ctx.work / 'domain_substitution.filtered.list'
    flist.write_text('\n'.join(filtered) + '\n')
    ctx.domsub_cache.parent.mkdir(parents=True, exist_ok=True)
    helium_python(ctx, 'domain_substitution.py', 'apply', '-r', str(ctx.hc / 'domain_regex.list'),
                  '-f', str(flist), '-c', str(ctx.domsub_cache), str(ctx.tree))
    print(f'substituted Helium\'s list minus {len(kept)} store files'
          + (f'; keep patterns matching nothing: {", ".join(unused)}' if unused else ''))


def helium_python(ctx, script, *args, quiet=True):
    p = subprocess.run([sys.executable, str(ctx.hc / 'utils' / script), *args], cwd=ctx.work,
                       capture_output=quiet, text=True)
    if p.returncode:
        raise StageError(f'{script} failed:\n{(p.stdout or "")[-3000:]}{(p.stderr or "")[-3000:]}')
    return p


def stage_namesub(ctx):
    ctx.work.mkdir(parents=True, exist_ok=True)
    p = helium_python(ctx, 'name_substitution.py', '--sub', '-t', str(ctx.tree))
    print(p.stdout.strip().splitlines()[-1])
    p = helium_python(ctx, 'i18n_apply.py', '-t', str(ctx.tree))
    print(f'i18n: {len(p.stdout.strip().splitlines())} languages')


def stage_brand_namesub(ctx):
    script = HERE / 'ardia_namesub.py'
    if ctx.no_brand:
        print('skipped (--no-brand)')
        return
    if not script.exists():
        raise StageError(f'{script} is missing; --no-brand skips the Ardia branding')
    p = subprocess.run([sys.executable, str(script), '--tree', str(ctx.tree), '--helium', str(ctx.hc)],
                       cwd=ctx.work, capture_output=True, text=True)
    if p.returncode:
        raise StageError(f'ardia_namesub.py failed:\n{p.stdout[-3000:]}{p.stderr[-3000:]}')
    print((p.stdout.strip().splitlines() or ['done'])[-1])


def stage_version(ctx):
    f = ctx.tree / 'chrome/VERSION'
    text = f.read_text()
    if 'HELIUM_' in text:
        raise StageError('chrome/VERSION already has HELIUM_* lines')
    parts = dict(l.split('=', 1) for l in text.split() if '=' in l)
    lines = [f'HELIUM_{h}={parts[c]}' for h, c in
             (('MAJOR', 'MAJOR'), ('MINOR', 'MINOR'), ('PATCH', 'BUILD'), ('PLATFORM', 'PATCH'))]
    f.write_text(text + ''.join(l + '\n' for l in lines))
    print('chrome/VERSION: ' + ' '.join(lines))


def resource_lines(listing):
    for n, line in enumerate(listing.read_text().splitlines(), 1):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        parts = line.split()
        if len(parts) != 2:
            raise StageError(f'{listing}:{n}: expected `<source> <dest>`')
        yield parts


def generate_icons(ctx):
    out = ctx.work / 'helium-resources'
    for line in (ctx.hc / 'resources/generate_resources.txt').read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        source, size, dest = line.split()
        target = out / dest
        target.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(['sips', '-s', 'format', 'png', '-z', size, size, str(ctx.hc / 'resources' / source),
                        '--out', str(target)], check=True, capture_output=True)
    return out


def copy_resources(ctx, listing, roots):
    count = 0
    for source, dest in resource_lines(listing):
        found = next((r / source for r in roots if (r / source).is_file()), None)
        if found is None:
            raise StageError(f'{listing}: no {source}')
        target = ctx.tree / dest
        if not target.parent.is_dir():
            raise StageError(f'{listing}: {dest}: no such directory in the tree')
        shutil.copyfile(found, target)
        count += 1
    return count


def stage_resources(ctx):
    generated = generate_icons(ctx)
    count = copy_resources(ctx, ctx.hc / 'resources/helium_resources.txt', [generated, ctx.hc / 'resources'])
    print(f'Helium: {count} resources')
    listing = HERE / 'ardia_resources.txt'
    if ctx.no_brand:
        print('Ardia resources skipped (--no-brand)')
        return
    if not listing.exists():
        raise StageError(f'{listing} is missing; --no-brand skips the Ardia branding')
    roots = list(dict.fromkeys([REPO, HERE.parent.parent.parent]))
    print(f'Ardia: {copy_resources(ctx, listing, roots)} resources')


def write_marker(marker, lines):
    tmp = marker.with_name(f'{marker.name}.{os.getpid()}.tmp')
    with open(tmp, 'w') as f:
        f.write(''.join(line + '\n' for line in lines))
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, marker)
    dir_fd = os.open(str(marker.parent), os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(dir_fd)
    finally:
        os.close(dir_fd)


HANDLERS = {
    'pins': stage_pins, 'guard': stage_guard, 'patches': stage_patches, 'fixups': stage_fixups,
    'domsub': stage_domsub, 'namesub': stage_namesub, 'brand-namesub': stage_brand_namesub,
    'version': stage_version, 'resources': stage_resources,
}


def holds_lock_for(path):
    if pathguard.reaches(path):
        return pathguard.real_lock_held()
    return pathguard.chromium_lock_held()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--tree', type=pathlib.Path,
                        default=pathlib.Path(os.environ.get('CHROMIUM_SRC', CB / 'chromium_git/chromium/src')))
    parser.add_argument('--helium', type=pathlib.Path,
                        default=pathlib.Path(os.environ.get('HELIUM_DIR', CB / 'helium')))
    parser.add_argument('--helium-macos', type=pathlib.Path,
                        default=pathlib.Path(os.environ.get('HELIUM_MACOS_DIR', CB / 'helium-macos')))
    parser.add_argument('--domsub-cache', type=pathlib.Path,
                        help='default: ~/chromium-build/domsubcache.tar.gz for the live tree, else in --work')
    parser.add_argument('--work', type=pathlib.Path, default=None)
    parser.add_argument('--report', type=pathlib.Path,
                        help='default: ~/chromium-build/logs/helium-patches.tsv for the live tree, else in --work')
    parser.add_argument('--only', default='')
    parser.add_argument('--from', dest='start', choices=STAGES)
    parser.add_argument('--no-brand', action='store_true')
    parser.add_argument('--apply', action='store_true', help='required to change the live tree')
    parser.add_argument('--guard-extra', action='append', default=[], metavar='PATCH')
    args = parser.parse_args()

    ctx = argparse.Namespace(tree=args.tree.resolve(), hc=args.helium.resolve(), hm=args.helium_macos.resolve(),
                             no_brand=args.no_brand, guard_extra=args.guard_extra)
    ctx.work = (args.work or pathlib.Path(tempfile.mkdtemp(prefix='helium-work-'))).resolve()
    live = bool(pathguard.reaches(ctx.tree))
    ctx.domsub_cache = (args.domsub_cache or (CB if live else ctx.work) / 'domsubcache.tar.gz').resolve()
    ctx.report = args.report or (CB / 'logs' if live else ctx.work) / 'helium-patches.tsv'
    stages = STAGES
    if args.only:
        stages = [s.strip() for s in args.only.split(',')]
        unknown = [s for s in stages if s not in STAGES]
        if unknown:
            parser.error(f'unknown stage {", ".join(unknown)}; stages: {", ".join(STAGES)}')
    elif args.start:
        stages = STAGES[STAGES.index(args.start):]
    if not (ctx.tree / 'chrome/VERSION').exists():
        parser.error(f'{ctx.tree} is not a chromium/src tree')
    mutating = [s for s in stages if s in MUTATING]
    if mutating and not live:
        pathguard.require_tree_writable(str(ctx.tree), None, '03-helium.py')
        pathguard.require_writable([str(ctx.work), str(ctx.domsub_cache), str(ctx.report),
                                    str(ctx.tree.parent / f'.helium-stages-{ctx.tree.name}')], '03-helium.py')
    if mutating and live:
        if not args.apply:
            parser.error('the live tree: pass --apply to change it')
        if not holds_lock_for(ctx.tree):
            parser.error('the live tree: hold the real chromium lock (scripts/agent/locked chromium --as <you> -- ...)')
        pathguard.require_writable([str(ctx.work), str(ctx.domsub_cache), str(ctx.report)], '03-helium.py')

    marker = ctx.tree.parent / f'.helium-stages-{ctx.tree.name}'
    identity = f'tree-inode={ctx.tree.stat().st_ino}'
    recorded = marker.read_text().split() if marker.exists() else []
    if marker.exists() and not recorded[:1] and mutating:
        print(f'{marker} is empty or unreadable: a run was interrupted; start again from a fresh tree', file=sys.stderr)
        return 1
    done = set(recorded[1:]) if recorded[:1] == [identity] else set()
    broken = sorted(d for d in done if d.startswith('started:') and d[len('started:'):] not in done)
    if broken and mutating:
        print(f'{ctx.tree}: a previous run died during {", ".join(b[len("started:"):] for b in broken)} '
              f'({marker}); start again from a fresh tree', file=sys.stderr)
        return 1
    if 'patches' in stages and 'patches' not in done and (ctx.tree / 'chrome/browser/ungoogled_flag_choices.h').exists():
        print(f'{ctx.tree} is already patched by Helium; this step runs once, on a fresh '
              f'checkout', file=sys.stderr)
        return 1
    for stage in stages:
        print(f'== {stage}', flush=True)
        if stage in MUTATING and stage in done:
            print(f'{stage} already ran on {ctx.tree} ({marker}); it isn\'t idempotent', file=sys.stderr)
            return 1
        if stage in MUTATING:
            done.add(f'started:{stage}')
            write_marker(marker, [identity] + sorted(done))
        try:
            HANDLERS[stage](ctx)
        except StageError as e:
            print(f'FAILED at {stage}:\n{e}', file=sys.stderr)
            return 1
        if stage in MUTATING:
            done.add(stage)
            write_marker(marker, [identity] + sorted(done))
        sys.stdout.flush()
    return 0


if __name__ == '__main__':
    sys.exit(main())
