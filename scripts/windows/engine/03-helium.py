#!/usr/bin/env python3
"""Step 3 (Windows): turn a Chromium $CHROMIUM_VERSION tree into Helium's for Windows, as Ardia takes it.

The Mac step (engine/patches/build/03-helium.py) with helium-windows in place of helium-macos: helium-chromium $HELIUM_TAG plus
helium-windows (scripts/windows/engine/helium-pins.ini pins both by commit; the checkouts are $CB/helium and $CB/helium-windows).
The stages, the omitted downloads, the guard and the Mac step's skips of helium-chromium patches are the same.
The helium-macos skips are replaced by WINDOWS_SKIP, and scripts/windows/engine/ardia_resources_win.txt adds the Windows icons after
the Mac step's resources. --helium-macos takes the helium-windows checkout.

Usage: scripts/windows/engine/03-helium.py --apply [--only STAGE,...] [--from STAGE] [--no-brand] (under the chromium lock)
"""
import configparser
import importlib.util
import os
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]
MAC_DIR = REPO_ROOT / 'engine/patches/build'
CB = pathlib.Path(os.environ.get('AC_CHROMIUM_BUILD') or pathlib.Path.home() / 'chromium-build-win')
os.environ['AC_CHROMIUM_BUILD'] = str(CB)
os.environ.setdefault('HELIUM_DIR', str(CB / 'helium'))
os.environ['HELIUM_MACOS_DIR'] = os.environ.get('HELIUM_WINDOWS_DIR', str(CB / 'helium-windows'))

sys.path.insert(0, str(MAC_DIR))
spec = importlib.util.spec_from_file_location('helium_mac', MAC_DIR / '03-helium.py')
mac = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mac)

WINDOWS_SKIP = {
    'ungoogled-chromium/windows/windows-disable-encryption.patch':
        'a --disable-encryption switch that stores cookies and passwords unencrypted',
    'helium/windows/rbe-linux-workers.patch': 'Helium\'s remote build setup',
    'helium/windows/updater/winsparkle-drop-3rdparty-deps.patch': 'WinSparkle; the app has its own updater',
    'helium/windows/updater/winsparkle-api-extensions.patch': 'WinSparkle; the app has its own updater',
    'helium/windows/updater/winsparkle-headless-ui.patch': 'WinSparkle; the app has its own updater',
    'helium/windows/updater/glue.patch': 'WinSparkle; the app has its own updater',
    'helium/windows/updater/build-wiring.patch': 'WinSparkle; the app has its own updater',
    'helium/windows/updater/register.patch': 'WinSparkle; the app has its own updater',
    'helium/windows/updater/helper.patch': 'WinSparkle; the app has its own updater',
    'helium/windows/updater/update-notifications.patch': 'WinSparkle; the app has its own updater',
}

WINDOWS_GUARD_MARKERS = [('os_crypt', False), ('DPAPI', False), ('app_bound', True), ('elevation_service', False)]

WINDOWS_GUARD_ALLOWED = {
    ('helium/core/sync/service-backends.patch', 'os_crypt',
     '+#include "components/os_crypt/async/common/encryptor.h"'),
    ('helium/core/sync/service-backends.patch', 'os_crypt',
     '+    scoped_refptr<os_crypt_async::Encryptor> encryptor) {'),
    ('helium/core/sync/service-backends.patch', 'os_crypt', '+namespace os_crypt_async {'),
    ('helium/core/sync/service-backends.patch', 'os_crypt',
     '+      scoped_refptr<os_crypt_async::Encryptor> encryptor);'),
    ('ungoogled-chromium/windows/windows-disable-event-log.patch', 'elevation_service',
     '+++ b/chrome/elevation_service/BUILD.gn'),
    ('ungoogled-chromium/windows/windows-disable-event-log.patch', 'elevation_service',
     '+++ b/chrome/elevation_service/elevation_service_delegate.cc'),
    ('helium/windows/bundle-elevation-service.patch', 'elevation_service', '+    "//chrome/elevation_service",'),
    ('helium/windows/bundle-elevation-service.patch', 'elevation_service',
     '+elevation_service.exe: %(VersionDir)s\\'),
}


def windows_pins():
    config = configparser.ConfigParser(interpolation=None)
    config.read(HERE / 'helium-pins.ini')
    return config


def windows_helium_patches(ctx):
    for repo, tag in ((ctx.hc, 'helium-chromium'), (ctx.hm, 'helium-windows')):
        for name in mac.series(repo):
            yield tag, name, repo / 'patches' / name


def stage_pins_windows(ctx):
    config = windows_pins()
    problems = []
    for section, repo in (('helium-chromium', ctx.hc), ('helium-windows', ctx.hm)):
        want = config[section]['commit']
        head = mac.git(repo, 'rev-parse', 'HEAD').stdout.strip()
        if head != want:
            problems.append(f'{repo} is at {head or "no checkout"}, not {section} {config[section]["tag"]} ({want})')
        dirty = mac.git(repo, 'status', '--porcelain', '--untracked-files=no').stdout.strip()
        if dirty:
            problems.append(f'{repo} has local changes:\n{dirty}')
    chromium = config['chromium']['version']
    if os.environ.get('CHROMIUM_VERSION', chromium) != chromium:
        problems.append(f'env.sh CHROMIUM_VERSION {os.environ["CHROMIUM_VERSION"]} != scripts/windows/engine/helium-pins.ini {chromium}')
    mac_pins = mac.pins()
    if mac_pins['helium-chromium']['commit'] != config['helium-chromium']['commit']:
        problems.append('scripts/windows/engine/helium-pins.ini and helium-pins.ini pin different helium-chromium commits')
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
        if not out.startswith(mac.OMITTED):
            problems.append(f'deps.ini [{section}] downloads into {out}, which Ardia doesn\'t omit: decide on it')
    if problems:
        raise mac.StageError('\n'.join(problems))
    print(f'Helium {config["helium-chromium"]["tag"]} / Windows {config["helium-windows"]["tag"]} on Chromium {chromium}')


mac_stage_resources = mac.stage_resources


def stage_resources_windows(ctx):
    mac_stage_resources(ctx)
    if ctx.no_brand:
        return
    roots = list(dict.fromkeys([mac.REPO, REPO_ROOT]))
    print(f'Ardia Windows: {mac.copy_resources(ctx, HERE / "ardia_resources_win.txt", roots)} resources')


def install():
    mac.__doc__ = __doc__
    mac.SKIP = {k: v for k, v in mac.SKIP.items() if not k.startswith(('helium/macos/', 'rebel/macos/'))}
    mac.SKIP.update(WINDOWS_SKIP)
    mac.GUARD_MARKERS = mac.GUARD_MARKERS + WINDOWS_GUARD_MARKERS
    mac.GUARD_ALLOWED = {a for a in mac.GUARD_ALLOWED if not a[0].startswith('helium/macos/')} | WINDOWS_GUARD_ALLOWED
    mac.pins = windows_pins
    mac.helium_patches = windows_helium_patches
    mac.HANDLERS['pins'] = stage_pins_windows
    mac.HANDLERS['resources'] = stage_resources_windows


def main():
    install()
    argv = sys.argv[1:]
    if not any(a in ('-h', '--help') for a in argv):
        if '--apply' not in argv:
            sys.exit('03-helium.py: it changes $AC_CHROMIUM_BUILD: pass --apply to run it (--help for usage)')
        if not mac.pathguard.chromium_lock_held():
            sys.exit('03-helium.py: hold the chromium lock (lockf on $AC_LOCK_ROOT/ac-chromium.lockf)')
    defaults = {'--work': CB / 'helium-work', '--report': CB / 'logs/helium-patches.tsv',
                '--domsub-cache': CB / 'domsubcache.tar.gz'}
    for flag, value in defaults.items():
        if not any(a == flag or a.startswith(flag + '=') for a in argv):
            argv += [flag, str(value)]
    (CB / 'logs').mkdir(parents=True, exist_ok=True)
    sys.argv = [sys.argv[0]] + argv
    return mac.main()


if __name__ == '__main__':
    sys.exit(main())
