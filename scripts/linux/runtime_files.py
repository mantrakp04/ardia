#!/usr/bin/env python3
import argparse
import json
import lzma
import os
import pathlib
import posixpath
import shutil
import stat
import sys
import tarfile

REQUIRED = ('chrome', 'chrome_crashpad_handler', 'icudtl.dat', 'resources.pak', 'chrome_100_percent.pak', 'chrome_200_percent.pak', 'locales', 'v8_context_snapshot.bin')
OPTIONAL = ('snapshot_blob.bin', 'libEGL.so', 'libGLESv2.so', 'libvk_swiftshader.so', 'vk_swiftshader_icd.json', 'libvulkan.so.1', 'libqt5_shim.so', 'libqt6_shim.so', 'chrome_sandbox', 'manifest.json')
NEVER_STRIPPED = ('chrome_sandbox',)
LOCALE_BUILD_FILES = ('*.info',)
ARCHIVE_ROOT = 'ardiacore-linux-x64'
MANIFEST_FORMAT = 1
TARGET_OS = 'linux'
TARGET_CPU = 'x64'


def archive_name(tree):
    return f'ArdiaCore-{tree[:12]}-linux-{TARGET_CPU}.tar.xz'


def release_tag(tree):
    return f'engine-{tree[:12]}'


def missing(directory):
    return [name for name in REQUIRED if not (directory / name).exists()]


def select(directory):
    absent = missing(directory)
    if absent:
        raise ValueError(f'missing Linux build outputs in {directory}: ' + ', '.join(absent))
    if not (directory / 'locales').is_dir():
        raise ValueError(f'{directory}/locales is not a directory')
    if not os.access(directory / 'chrome', os.X_OK):
        raise ValueError('chrome is not executable')
    return list(REQUIRED) + [name for name in OPTIONAL if (directory / name).exists()]


def copy(source, destination):
    names = select(source)
    destination.mkdir(parents=True, exist_ok=True)
    for name in names:
        path = source / name
        if path.is_dir():
            shutil.copytree(path, destination / name, ignore=shutil.ignore_patterns(*LOCALE_BUILD_FILES))
        else:
            shutil.copy2(path, destination / name)
    return names


def is_elf(path):
    if path.is_symlink() or not path.is_file():
        return False
    with path.open('rb') as handle:
        return handle.read(4) == b'\x7fELF'


def strippable(directory):
    return [directory / name for name in REQUIRED + OPTIONAL if name not in NEVER_STRIPPED and is_elf(directory / name)]


def check_manifest(directory, tree):
    path = directory / 'manifest.json'
    if not path.is_file():
        raise ValueError('the engine archive holds no manifest.json')
    manifest = json.loads(path.read_text())
    expected = {'format': MANIFEST_FORMAT, 'engine_tree': tree, 'target_os': TARGET_OS, 'target_cpu': TARGET_CPU}
    wrong = [f'{key} is {manifest.get(key)!r}, not {value!r}' for key, value in expected.items() if manifest.get(key) != value]
    if wrong:
        raise ValueError('the engine manifest does not match: ' + '; '.join(wrong))
    return manifest


def check_member(member, root):
    name = member.name
    parts = name.split('/')
    if name.startswith('/') or '\\' in name or '..' in parts or (parts[0] != root) or '' in parts[1:-1]:
        raise ValueError(f'unsafe archive entry {name!r}')
    if member.isdir() or member.isreg():
        return
    if member.issym() or member.islnk():
        target = member.linkname
        if target.startswith('/'):
            raise ValueError(f'archive link {name!r} points outside the engine')
        anchor = posixpath.dirname(name) if member.issym() else ''
        resolved = posixpath.normpath(posixpath.join(anchor, target))
        if resolved != root and not resolved.startswith(root + '/'):
            raise ValueError(f'archive link {name!r} points outside the engine')
        return
    raise ValueError(f'archive entry {name!r} is not a file, directory or link')


def unpack(archive, into, tree):
    into.mkdir(parents=True, exist_ok=False)
    extract_filter = getattr(tarfile, 'data_filter', None)
    with tarfile.open(archive, 'r|xz') as packed:
        for member in packed:
            check_member(member, ARCHIVE_ROOT)
            if extract_filter is not None:
                packed.extract(member, into, filter='data')
            else:
                member.mode &= ~(stat.S_ISUID | stat.S_ISGID)
                packed.extract(member, into)
    engine = into / ARCHIVE_ROOT
    if not engine.is_dir():
        raise ValueError(f'the engine archive holds no {ARCHIVE_ROOT}/ directory')
    check_manifest(engine, tree)
    select(engine)
    return engine


def main():
    parser = argparse.ArgumentParser(description='Selects, copies and checks the Chromium runtime files Ardia ships on Linux.')
    commands = parser.add_subparsers(dest='command', required=True)
    listing = commands.add_parser('list', help='print the runtime files present in a Chromium out dir or engine dir')
    listing.add_argument('directory', type=pathlib.Path)
    copying = commands.add_parser('copy', help='copy the runtime files of a Chromium out dir or engine dir')
    copying.add_argument('source', type=pathlib.Path)
    copying.add_argument('destination', type=pathlib.Path)
    unpacking = commands.add_parser('unpack', help='safely unpack and check an engine archive')
    unpacking.add_argument('--archive', type=pathlib.Path, required=True)
    unpacking.add_argument('--into', type=pathlib.Path, required=True)
    unpacking.add_argument('--tree', required=True)
    args = parser.parse_args()
    try:
        if args.command == 'list':
            print('\n'.join(select(args.directory)))
        elif args.command == 'copy':
            copy(args.source, args.destination)
        else:
            print(unpack(args.archive, args.into, args.tree))
    except (ValueError, OSError, tarfile.TarError, lzma.LZMAError, EOFError, json.JSONDecodeError) as error:
        print(f'runtime_files.py: {error}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
