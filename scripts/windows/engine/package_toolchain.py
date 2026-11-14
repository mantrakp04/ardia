#!/usr/bin/env python3
"""Packs a Visual Studio and Windows SDK tree that msvc-wine's vsdownload.py unpacked (--msvc DIR) into the zip
Chromium's cross build takes, in the layout depot_tools/win_toolchain/package_from_installed.py gives on Windows:
VC/Tools/MSVC/<ver>/{bin,include,lib,atlmfc,crt}, VC/redist, DIA SDK/{bin,idl,include,lib}, "Windows Kits/10" (only
the --winver files of Include, Lib, Source and bin), sys32/sys64/sysarm64 runtimes, the SetEnv files and VS_VERSION.
The zip is named for the hash get_toolchain_if_necessary.py computes from the unpacked files (first 10 characters).
When the SDK has no Debuggers directory (the SDK inside Visual Studio's packages doesn't), --debuggers-from gives
Microsoft's debugger engine package (NuGet Microsoft.Debugging.Platform.DbgEng, unpacked): its dbghelp.dll and
dbgcore.dll for x64, x86 and arm64 go in Windows Kits/10/Debuggers/<cpu>, which vs_toolchain.py copies from.

Usage: package_toolchain.py --msvc DIR --winver 10.0.28000.0 --vs-version 2026 --depot-tools DIR --out ZIPDIR
         [--debuggers-from DIR] [--stored]
"""
import argparse
import glob
import os
import shutil
import sys
import tempfile
import zipfile

SDK_SKIP = ('References/', 'Windows Performance Toolkit/', 'Testing/', 'App Certification Kit/', 'Extension SDKs/',
            'Assessment and Deployment Kit/')
VERSIONED = ('Include/', 'Lib/', 'Source/', 'bin/')


def walk(base):
    for root, _, files in os.walk(base):
        for f in files:
            yield os.path.join(root, f)


def one(pattern):
    found = sorted(glob.glob(pattern))
    if len(found) != 1:
        sys.exit(f'expected one match for {pattern}, found {found}')
    return found[0]


def build_file_list(vs, winver, vc_tools, debuggers_from):
    result = []
    for rel in ['DIA SDK/bin', 'DIA SDK/idl', 'DIA SDK/include', 'DIA SDK/lib', f'{vc_tools}/atlmfc',
                f'{vc_tools}/crt', 'VC/redist', f'{vc_tools}/bin', f'{vc_tools}/include', f'{vc_tools}/lib']:
        base = os.path.join(vs, rel)
        if not os.path.isdir(base):
            sys.exit(f'{base} missing')
        for path in walk(base):
            if os.path.basename(path).lower() == 'vctip.exe':
                continue
            result.append((path, os.path.relpath(path, vs)))
    redist = one(os.path.join(vs, 'VC/redist/MSVC/14.*.*'))
    pairs = [
        ('x86/Microsoft.VC*.CRT', 'sys32'), ('x86/Microsoft.VC*.CRT', 'Windows Kits/10/bin/x86'),
        ('debug_nonredist/x86/Microsoft.VC*.DebugCRT', 'sys32'),
        ('x64/Microsoft.VC*.CRT', 'sys64'), ('x64/Microsoft.VC*.CRT', 'VC/bin/amd64_x86'),
        ('x64/Microsoft.VC*.CRT', 'VC/bin/amd64'), ('x64/Microsoft.VC*.CRT', 'Windows Kits/10/bin/x64'),
        ('debug_nonredist/x64/Microsoft.VC*.DebugCRT', 'sys64'),
        ('arm64/Microsoft.VC*.CRT', 'sysarm64'), ('arm64/Microsoft.VC*.CRT', 'VC/bin/amd64_arm64'),
        ('arm64/Microsoft.VC*.CRT', 'VC/bin/arm64'), ('arm64/Microsoft.VC*.CRT', 'Windows Kits/10/bin/arm64'),
        ('debug_nonredist/arm64/Microsoft.VC*.DebugCRT', 'sysarm64'),
    ]
    for pattern, dest in pairs:
        base = one(os.path.join(redist, pattern))
        for path in walk(base):
            if os.path.basename(path).lower() == 'vctip.exe':
                continue
            result.append((path, os.path.join(dest, os.path.relpath(path, base))))
    sdk = os.path.join(vs, 'Windows Kits/10')
    for path in walk(sdk):
        tail = os.path.relpath(path, sdk)
        if tail.startswith(SDK_SKIP):
            continue
        if tail.startswith(VERSIONED) and winver not in tail:
            continue
        result.append((path, os.path.join('Windows Kits/10', tail)))
    for cpu, dests in (('x86', ['Windows Kits/10/bin/x86', 'sys32']),
                       ('x64', ['VC/bin/amd64_x86', 'VC/bin/amd64', 'Windows Kits/10/bin/x64', 'sys64'])):
        ucrt = os.path.join(sdk, 'Redist', winver, 'ucrt/DLLs', cpu)
        if not os.path.isdir(ucrt):
            ucrt = os.path.join(sdk, 'Redist/ucrt/DLLs', cpu)
        dlls = sorted(glob.glob(os.path.join(ucrt, '*')))
        if not dlls:
            sys.exit(f'no ucrt DLLs in {ucrt}')
        for dll in dlls:
            for dest in dests:
                result.append((dll, os.path.join(dest, os.path.basename(dll))))
    for cpu, dest in (('x86', 'sys32'), ('x64', 'sys64'), ('arm64', 'sysarm64')):
        result.append((os.path.join(sdk, 'bin', winver, cpu, 'ucrt/ucrtbased.dll'), os.path.join(dest, 'ucrtbased.dll')))
    if not os.path.isdir(os.path.join(sdk, 'Debuggers')):
        if not debuggers_from:
            sys.exit(f'{sdk}/Debuggers is missing: pass --debuggers-from')
        for package_cpu, cpu in (('amd64', 'x64'), ('x86', 'x86'), ('arm64', 'arm64')):
            for dll in ('dbghelp.dll', 'dbgcore.dll'):
                result.append((os.path.join(debuggers_from, 'content', package_cpu, dll),
                               f'Windows Kits/10/Debuggers/{cpu}/{dll}'))

    def skippable(f):
        low = f.lower()
        return '/arm/' in low or '/samples/' in low or low.endswith(('.msi', '.msm'))
    files = {}
    for src, dst in result:
        if skippable(src):
            continue
        files[dst.replace('\\', '/').lower()] = (src, dst)
    return list(files.values())


def set_env_files(depot_tools, vc_tools, winver, vs_version, stage):
    sys.path.insert(0, os.path.join(depot_tools, 'win_toolchain'))
    import package_from_installed as pfi
    pfi._vc_tools = vc_tools
    pfi._win_version = winver
    pfi._vs_version = vs_version
    tmp = tempfile.mkdtemp()
    os.makedirs(os.path.join(tmp, 'Windows Kits', '10', 'bin'))
    pfi.GenerateSetEnvCmd(tmp)
    out = []
    for name in ('SetEnv.cmd', 'SetEnv.x86.json', 'SetEnv.x64.json', 'SetEnv.arm64.json'):
        written = os.path.join(tmp, 'Windows Kits\\10\\bin\\' + name)
        if not os.path.exists(written):
            written = os.path.join(tmp, 'Windows Kits', '10', 'bin', name)
        out.append((written, f'Windows Kits/10/bin/{name}'))
    version_file = os.path.join(tmp, 'VS_VERSION')
    with open(version_file, 'w', newline='') as f:
        print(vs_version, file=f)
    out.append((version_file, 'VS_VERSION'))
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--msvc', required=True)
    parser.add_argument('--winver', required=True)
    parser.add_argument('--vs-version', required=True)
    parser.add_argument('--depot-tools', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--debuggers-from')
    parser.add_argument('--stored', action='store_true')
    args = parser.parse_args()
    vs = os.path.abspath(args.msvc)
    vc_tools = os.path.relpath(one(os.path.join(vs, 'VC/Tools/MSVC/14.*.*')), vs)
    files = build_file_list(vs, args.winver, vc_tools, args.debuggers_from)
    files += set_env_files(args.depot_tools, vc_tools, args.winver, args.vs_version, None)
    missing = [s for s, _ in files if not os.path.exists(s)]
    if missing:
        sys.exit(f'{len(missing)} files missing, first: {missing[0]}')
    total = sum(os.path.getsize(s) for s, _ in files)
    print(f'{total / 1e9:.3f} GB in {len(files)} files; MSVC {vc_tools}, SDK {args.winver}', flush=True)
    os.makedirs(args.out, exist_ok=True)
    work = tempfile.mkdtemp(dir=args.out)
    stage = os.path.join(work, 'vs_files')
    for src, dst in files:
        target = os.path.join(stage, dst)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.copyfile(src, target)
    sys.path.insert(0, os.path.join(args.depot_tools, 'win_toolchain'))
    sys.path.insert(0, args.depot_tools)
    import get_toolchain_if_necessary as gtin
    cwd = os.getcwd()
    os.chdir(work)
    sha1 = gtin.CalculateHash('vs_files', None)[:10]
    os.chdir(cwd)
    zip_path = os.path.join(args.out, f'{sha1}.zip')
    method = zipfile.ZIP_STORED if args.stored else zipfile.ZIP_DEFLATED
    tmp_zip = zip_path + '.tmp'
    with zipfile.ZipFile(tmp_zip, 'w', method, True) as zf:
        for root, _, names in os.walk(stage):
            for name in sorted(names):
                path = os.path.join(root, name)
                zf.write(path, os.path.relpath(path, stage))
    os.replace(tmp_zip, zip_path)
    shutil.rmtree(work)
    print(f'hash {sha1}')
    print(zip_path)


if __name__ == '__main__':
    sys.exit(main())
