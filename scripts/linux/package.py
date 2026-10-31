#!/usr/bin/env python3
import argparse
import json
import os
import pathlib
import shutil
import sys
import tarfile
import tempfile

sys.dont_write_bytecode = True
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import runtime_files

BRIDGE = pathlib.Path(__file__).resolve().parents[2] / 'engine/ardiacore-linux/content-blocker'
BRIDGE_SCRIPTS = ('js/vapi.js', 'js/vapi-common.js', 'js/vapi-client.js')
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


def package(output, ui, destination, content_blocker=None):
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
    args = parser.parse_args()
    try:
        blocker = args.content_blocker.resolve() if args.content_blocker else None
        print(package(args.out.resolve(), args.ui.resolve(), args.destination.resolve(), blocker))
    except (ValueError, OSError, json.JSONDecodeError) as error:
        parser.error(str(error))


if __name__ == '__main__':
    main()
