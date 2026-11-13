#!/usr/bin/env python3
"""Check a built engine for what Ardia leaves out of Helium: its uBlock Origin, its onboarding page, the non-free
search engine data, and Helium's own hosts.

  helium-check-build.py [--out OUT_DIR] [--framework FRAMEWORK] [--pak PAK]…

Fails (exit 1) when:
  - OUT_DIR has build outputs for third_party/ublock, components/helium_onboarding or
    third_party/search_engines_data/resources_internal, or a ublock / helium_onboarding pak;
  - a resource in any pak (the framework's, every locale's, and each --pak), decompressed (gzip, brotli), holds
    uBlock Origin's code (µBlock, uBlock0) or the onboarding page (helium-onboarding, Instrument Sans);
  - the framework binary or a pak names a Helium host (helium.computer, imput.net, services.helium).
It also prints how many resources still say "Helium" or helium://, for the branding check.

OUT_DIR defaults to ~/chromium-build/chromium_git/chromium/src/out/Release_GN_arm64 and FRAMEWORK to its
"Chromium Framework.framework". Reads only.
"""
import argparse
import gzip
import os
import pathlib
import shutil
import struct
import subprocess
import sys
import tempfile

from target_config import configuration

TARGET = configuration()
OUT = pathlib.Path(os.environ.get('AC_CHROMIUM_BUILD', pathlib.Path.home() / 'chromium-build')) / 'chromium_git/chromium/src/out' / TARGET['GN_OUT_CONFIGS']
OMITTED_GEN = ['gen/third_party/ublock', 'gen/components/helium_onboarding',
               'gen/third_party/search_engines_data/resources_internal']
OMITTED_CODE = {
    'Helium\'s uBlock Origin': [b'\xc2\xb5Block', b'uBlock0'],
    'Helium\'s onboarding page': [b'helium-onboarding', b'Instrument Sans'],
}
HOSTS = [b'helium.computer', b'imput.net', b'services.helium']
BRAND = [b'Helium', b'helium://']


def pak_resources(path):
    data = path.read_bytes()
    version = struct.unpack_from('<I', data)[0]
    if version == 5:
        count, _aliases = struct.unpack_from('<HH', data, 8)
        start = 12
    elif version == 4:
        count = struct.unpack_from('<I', data, 4)[0]
        start = 9
    else:
        raise SystemExit(f'{path}: pak version {version}')
    entries = [struct.unpack_from('<HI', data, start + 6 * i) for i in range(count + 1)]
    for (rid, offset), (_, end) in zip(entries, entries[1:]):
        yield rid, data[offset:end]


def decompressed(blobs, brotli):
    out, pending = {}, {}
    for key, blob in blobs.items():
        if blob[:2] == b'\x1f\x8b':
            try:
                out[key] = gzip.decompress(blob)
            except OSError:
                out[key] = blob
        elif blob[:2] == b'\x1e\x9b' and brotli:
            pending[key] = blob[8:]
        else:
            out[key] = blob
    if pending:
        with tempfile.TemporaryDirectory() as tmp:
            names = []
            for n, (key, blob) in enumerate(pending.items()):
                f = pathlib.Path(tmp) / f'{n}.br'
                f.write_bytes(blob)
                names.append((key, f))
            subprocess.run([brotli, '-d', '-f', '-j', *[str(f) for _, f in names]], check=True, cwd=tmp)
            for key, f in names:
                out[key] = f.with_suffix('').read_bytes()
    elif any(b[:2] == b'\x1e\x9b' for b in blobs.values()):
        raise SystemExit('brotli-compressed resources and no brotli tool (OUT_DIR/brotli or brotli on PATH)')
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--out', type=pathlib.Path, default=OUT)
    parser.add_argument('--framework', type=pathlib.Path)
    parser.add_argument('--binary', type=pathlib.Path)
    parser.add_argument('--platform', choices=('mac', 'linux'), default=TARGET['AC_TARGET_OS'])
    parser.add_argument('--pak', type=pathlib.Path, action='append', default=[])
    args = parser.parse_args()
    framework = args.framework or args.out / 'Chromium Framework.framework'
    brotli = str(args.out / 'brotli') if (args.out / 'brotli').exists() else shutil.which('brotli')
    problems = []

    for rel in OMITTED_GEN:
        if (args.out / rel).exists():
            problems.append(f'{args.out / rel} exists: it was built')
    if args.out.is_dir():
        for pak in list(args.out.glob('*.pak')) + list(args.out.glob('gen/**/*.pak')):
            if 'ublock' in pak.name or 'helium_onboarding' in pak.name:
                problems.append(f'{pak} exists')

    resources = framework / 'Versions/Current/Resources' if args.platform == 'mac' else args.out
    paks = sorted(resources.glob('*.pak')) + sorted(resources.glob('*.lproj/*.pak' if args.platform == 'mac' else 'locales/*.pak')) + args.pak
    if not paks:
        problems.append(f'no paks under {resources}')
    brand_hits, scanned = 0, 0
    for pak in paks:
        blobs = {rid: blob for rid, blob in pak_resources(pak)}
        for rid, body in decompressed(blobs, brotli).items():
            scanned += 1
            for what, markers in OMITTED_CODE.items():
                hit = next((m for m in markers if m in body), None)
                if hit:
                    problems.append(f'{pak.name} resource {rid}: {what} ({hit.decode(errors="replace")})')
            for host in HOSTS:
                if host in body:
                    problems.append(f'{pak.name} resource {rid}: names {host.decode()}')
            if any(m in body for m in BRAND):
                brand_hits += 1

    binary = args.binary or (framework / 'Versions/Current/Chromium Framework' if args.platform == 'mac' else args.out / 'chrome')
    if binary.exists():
        data = binary.read_bytes()
        for host in HOSTS:
            if host in data:
                problems.append(f'{binary.name} names {host.decode()}')
    elif not args.pak:
        problems.append(f'no {binary}')

    print(f'{scanned} resources in {len(paks)} paks scanned; {brand_hits} still say Helium or helium://')
    if problems:
        print('FAIL:\n  ' + '\n  '.join(problems))
        return 1
    print('OK: no Helium uBlock Origin, onboarding page, non-free search data or Helium hosts')
    return 0


if __name__ == '__main__':
    sys.exit(main())
