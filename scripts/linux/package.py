#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import pathlib
import re
import shutil
import sys
import tarfile
import tempfile

sys.dont_write_bytecode = True
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import runtime_files

REPO = pathlib.Path(__file__).resolve().parents[2]
BRIDGE = REPO / 'engine/ardiacore-linux/content-blocker'
BRIDGE_SCRIPTS = ('js/vapi.js', 'js/vapi-common.js', 'js/vapi-client.js')
CLI_INSTALLER = REPO / 'apps/cli/install.sh'
CLI_PLATFORM = 'linux-x64'
VERSION_PATTERN = re.compile(r'^[0-9]+\.[0-9]+\.[0-9]+(-[a-z]+\.[0-9]+)?$')
REQUIRED = runtime_files.REQUIRED


def check_content_blocker(source):
    manifest_path = source / 'manifest.json'
    if not manifest_path.is_file():
        raise ValueError(f'no uBlock Origin manifest at {manifest_path}')
    manifest = json.loads(manifest_path.read_text())
    if not isinstance(manifest.get('key'), str) or manifest.get('manifest_version') != 2:
        raise ValueError('the content blocker is not the keyed uBlock Origin build from scripts/linux/fetch-ubo.sh')
    missing = [name for name in BRIDGE_SCRIPTS if not (source / name).is_file()]
    if missing:
        raise ValueError('the content blocker lacks ' + ', '.join(missing))


def check_version(version):
    if not isinstance(version, str) or not VERSION_PATTERN.fullmatch(version):
        raise ValueError(f'bad version {version!r}: expected <major>.<minor>.<patch> or <major>.<minor>.<patch>-<channel>.<n>')
    return version


def cli_tarball_name(version):
    return f'ardia-cli-{version}-{CLI_PLATFORM}.tar.gz'


def sha256_of(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def check_cli(tarball, version, installer=CLI_INSTALLER):
    expected = cli_tarball_name(version)
    if tarball.name != expected:
        raise ValueError(f'the CLI tarball is {tarball.name}, not {expected} (the package version and {CLI_PLATFORM})')
    if not tarball.is_file():
        raise ValueError(f'no CLI tarball at {tarball}')
    if not installer.is_file():
        raise ValueError(f'no CLI installer at {installer}')
    digest = sha256_of(tarball)
    sidecar = tarball.with_name(tarball.name + '.sha256')
    if sidecar.exists():
        recorded = (sidecar.read_text().split() or [''])[0]
        if recorded != digest:
            raise ValueError(f'{tarball.name} has sha256 {digest}, but {sidecar.name} says {recorded!r}')
    top = f'ardia-cli-{version}'
    try:
        with tarfile.open(tarball, 'r:gz') as packed:
            names = packed.getnames()
    except (tarfile.TarError, OSError, EOFError) as error:
        raise ValueError(f'{tarball.name} is not a gzipped tarball: {error}') from None
    stray = [name for name in names if name.rstrip('/') != top and not name.startswith(top + '/')]
    if stray:
        raise ValueError(f'{tarball.name} has entries outside {top}/: ' + ', '.join(stray[:3]))
    if f'{top}/bin/ardia' not in names:
        raise ValueError(f'{tarball.name} has no {top}/bin/ardia')
    return digest


def add_cli(runtime, tarball, digest, installer=CLI_INSTALLER):
    cli = runtime / 'cli'
    cli.mkdir()
    cli.chmod(0o755)
    shutil.copyfile(tarball, cli / tarball.name)
    (cli / tarball.name).chmod(0o644)
    shutil.copyfile(installer, cli / 'ardia-cli-install.sh')
    (cli / 'ardia-cli-install.sh').chmod(0o755)
    (cli / 'ardia-cli.sha256').write_text(f'{digest}  {tarball.name}\n')
    (cli / 'ardia-cli.sha256').chmod(0o644)
    return digest


def package(output, ui, destination, content_blocker=None, version=None, cli=None):
    if version is not None:
        check_version(version)
    cli_digest = None
    if cli is not None:
        if version is None:
            raise ValueError('a package with the CLI needs --version')
        cli_digest = check_cli(cli, version)
    missing = runtime_files.missing(output)
    if missing:
        raise ValueError('missing Linux build outputs: ' + ', '.join(missing))
    if not (ui / 'index.html').is_file():
        raise ValueError(f'no UI bundle at {ui}/index.html')
    if not os.access(output / 'chrome', os.X_OK):
        raise ValueError('chrome is not executable')
    if destination.exists():
        raise ValueError(f'refusing to overwrite {destination}')
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='ardia-package-') as scratch:
        root = pathlib.Path(scratch) / 'ardia'
        runtime = root / 'lib/ardia'
        runtime.mkdir(parents=True)
        runtime_files.copy(output, runtime)
        shutil.copytree(ui, runtime / 'ardia-ui')
        if version is not None:
            (runtime / 'VERSION').write_text(version + '\n')
            (runtime / 'VERSION').chmod(0o644)
        if cli is not None:
            add_cli(runtime, cli, cli_digest)
        if content_blocker is not None:
            check_content_blocker(content_blocker)
            blocker = runtime / 'extensions/ublock'
            shutil.copytree(content_blocker, blocker, ignore=shutil.ignore_patterns('_metadata'))
            for path in sorted(BRIDGE.iterdir()):
                shutil.copy2(path, blocker / path.name)
        launcher = root / 'bin/ardia'
        launcher.parent.mkdir()
        launcher.write_text('#!/usr/bin/env sh\nardia_bin_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$ardia_bin_dir/../lib/ardia/chrome" "$@"\n')
        launcher.chmod(0o755)
        desktop = root / 'share/applications/ardia.desktop'
        desktop.parent.mkdir(parents=True)
        desktop.write_text('[Desktop Entry]\nType=Application\nName=Ardia\nExec=ardia %U\nIcon=ardia\nTerminal=false\nCategories=Network;WebBrowser;\nMimeType=text/html;x-scheme-handler/http;x-scheme-handler/https;\nStartupWMClass=ardia\n')
        policy = root / 'share/polkit-1/actions/dev.ardia.linux.policy'
        policy.parent.mkdir(parents=True)
        shutil.copyfile(pathlib.Path(__file__).resolve().parent / 'dev.ardia.linux.policy', policy)
        installer = root / 'install.sh'
        shutil.copyfile(pathlib.Path(__file__).resolve().parent / 'install.sh', installer)
        installer.chmod(0o755)
        icon = pathlib.Path(__file__).resolve().parents[2] / 'engine/chromium/src/chrome/app/theme/chromium/product_logo_256.png'
        if icon.is_file():
            target = root / 'share/icons/hicolor/256x256/apps/ardia.png'
            target.parent.mkdir(parents=True)
            shutil.copyfile(icon, target)
        with tarfile.open(destination, 'x:xz') as archive:
            archive.add(root, arcname='ardia')
    return destination


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=pathlib.Path, required=True)
    parser.add_argument('--ui', type=pathlib.Path, required=True)
    parser.add_argument('--destination', type=pathlib.Path, required=True)
    parser.add_argument('--content-blocker', type=pathlib.Path)
    parser.add_argument('--version', help='the Ardia version, written to lib/ardia/VERSION')
    parser.add_argument('--cli', type=pathlib.Path, help=f'the ardia-cli-<version>-{CLI_PLATFORM}.tar.gz to bundle in lib/ardia/cli (needs --version)')
    args = parser.parse_args()
    if args.cli is not None and args.version is None:
        parser.error('--cli needs --version')
    try:
        blocker = args.content_blocker.resolve() if args.content_blocker else None
        cli = args.cli.resolve() if args.cli else None
        print(package(args.out.resolve(), args.ui.resolve(), args.destination.resolve(), blocker, args.version, cli))
    except (ValueError, OSError, json.JSONDecodeError) as error:
        parser.error(str(error))


if __name__ == '__main__':
    main()
