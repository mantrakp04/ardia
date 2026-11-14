#!/usr/bin/env python3
"""Packs a Windows out dir with chrome/tools/build/make_zip.py and the tree's archive config, checks the zip against
gn's runtime deps of //chrome:chrome, adds RUN.txt and writes the result. Run by 06-package.sh.

Usage: package_win.py --src SRC --out OUT --config JSON --runtime-deps TXT --work DIR --zip ZIP --cpu CPU
         --chromium VERSION --helium TAG
"""
import argparse
import datetime
import os
import shutil
import subprocess
import sys
import zipfile

RUN_TXT = """Ardia's engine for Windows ({cpu})

Chromium {chromium} with Helium {helium} and Ardia's patches, cross-built on macOS on {date}.
Not an official build (no ThinLTO, no PGO). Nothing in it is signed: Windows SmartScreen and Smart App Control may
warn or block it, and there is no Authenticode signature to check.{emulated}

1. Unblock the download before unzipping (files from the internet carry Mark of the Web), in PowerShell:
     Unblock-File .\\{zip_name}
2. Unzip it. Everything is in the chrome-win folder.
3. Start it with a throwaway profile, from the folder that holds chrome-win:

   PowerShell:
     .\\chrome-win\\chrome.exe --user-data-dir="$env:TEMP\\ardia-throwaway-profile" --no-first-run --no-default-browser-check

   cmd.exe:
     chrome-win\\chrome.exe --user-data-dir="%TEMP%\\ardia-throwaway-profile" --no-first-run --no-default-browser-check

   For a log, add --enable-logging --v=1: it is written to chrome_debug.log in that profile folder.
4. To throw the profile away, quit it and delete %TEMP%\\ardia-throwaway-profile.

It installs nothing and registers nothing. The product name it shows is "Chromium"; Ardia's app is not in it.
"""

SKIP_SUFFIXES = ('.pdb', '.lib', '.exp', '.ilk', '.info', '.runtime_deps')


def runtime_deps(path):
    deps = []
    for line in open(path):
        line = line.strip()
        if not line:
            continue
        deps.append(line[2:] if line.startswith('./') else line)
    return deps


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for flag in ('--src', '--out', '--config', '--runtime-deps', '--work', '--zip', '--cpu', '--chromium', '--helium'):
        parser.add_argument(flag, required=True)
    args = parser.parse_args()
    out_dir = os.path.join(args.src, args.out)
    stage = os.path.join(args.work, 'chrome-win.zip')
    if os.path.exists(stage):
        os.remove(stage)
    p = subprocess.run([sys.executable, os.path.join(args.src, 'chrome/tools/build/make_zip.py'), out_dir,
                        args.config, stage], capture_output=True, text=True)
    with open(os.path.join(args.work, 'make_zip.log'), 'w') as f:
        f.write(p.stdout + p.stderr)
    if p.returncode:
        sys.exit(f'make_zip.py failed:\n{p.stdout}{p.stderr}')
    not_built = [l.split('warning: ', 1)[1].split(' not found', 1)[0] for l in p.stderr.splitlines() if 'warning:' in l]
    with zipfile.ZipFile(stage) as z:
        in_zip = {n.split('/', 1)[1].lower() for n in z.namelist() if '/' in n}
    deps = runtime_deps(args.runtime_deps)
    outside = [d for d in deps if d.startswith('../')]
    inside = [d for d in deps if not d.startswith('../')]
    missing, absent = [], []
    for d in inside:
        full = os.path.join(out_dir, d)
        if d.endswith('/'):
            files = [os.path.relpath(os.path.join(r, f), out_dir) for r, _, fs in os.walk(full) for f in fs]
        else:
            files = [d]
        for f in files:
            if f.endswith(SKIP_SUFFIXES) or f.lower() in in_zip:
                continue
            (missing if os.path.exists(os.path.join(out_dir, f)) else absent).append(f)
    report = os.path.join(args.work, 'missing-runtime-deps.txt')
    with open(report, 'w') as f:
        f.write(f'# runtime_deps of //chrome:chrome: {len(deps)} entries, {len(outside)} outside the out dir\n')
        f.write('# built but not in the zip:\n')
        f.writelines(m + '\n' for m in sorted(missing))
        f.write('# listed by gn, not in the out dir:\n')
        f.writelines(m + '\n' for m in sorted(absent))
        f.write('# outside the out dir (source files gn lists as data):\n')
        f.writelines(m + '\n' for m in sorted(outside))
        f.write('# in the archive config, not built:\n')
        f.writelines(m + '\n' for m in sorted(not_built))
    final = args.zip
    tmp = final + '.tmp'
    shutil.copyfile(stage, tmp)
    zip_name = os.path.basename(final)
    emulated = ('\nOn Windows on ARM this x64 build runs under emulation; use the arm64 zip there.'
                if args.cpu == 'x64' else '')
    with zipfile.ZipFile(tmp, 'a', compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr('chrome-win/RUN.txt', RUN_TXT.format(
            cpu=args.cpu, chromium=args.chromium, helium=args.helium, zip_name=zip_name, emulated=emulated,
            date=datetime.date.today().isoformat()).replace('\n', '\r\n'))
    os.replace(tmp, final)
    with zipfile.ZipFile(final) as z:
        infos = z.infolist()
    print(f'{final}: {len(infos)} files, {sum(i.file_size for i in infos) / 1e6:.0f} MB unpacked, '
          f'{os.path.getsize(final) / 1e6:.0f} MB')
    print(f'runtime deps: {len(missing)} built but not in the zip, {len(absent)} not built, '
          f'{len(outside)} source files; archive config entries not built: {len(not_built)}; see {report}')


if __name__ == '__main__':
    sys.exit(main())
