#!/usr/bin/env python3
import argparse
import json
import os
import platform
import re
import shlex


def configuration(target_os=None, target_cpu=None, env=None):
    env = os.environ if env is None else env
    target_os = target_os or env.get('AC_TARGET_OS') or {'Darwin': 'mac', 'Linux': 'linux'}.get(platform.system())
    if target_os not in ('mac', 'linux'):
        raise ValueError('AC_TARGET_OS must be mac or linux')
    target_cpu = target_cpu or env.get('AC_TARGET_CPU')
    if not target_cpu:
        target_cpu = 'arm64' if target_os == 'mac' else {'x86_64': 'x64', 'amd64': 'x64', 'aarch64': 'arm64', 'arm64': 'arm64'}.get(platform.machine().lower())
    if target_cpu not in ('arm64', 'x64'):
        raise ValueError('AC_TARGET_CPU must be arm64 or x64')
    output = env.get('GN_OUT_CONFIGS') or (f'Release_GN_{target_cpu}' if target_os == 'mac' else f'Release_GN_linux_{target_cpu}')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*', output):
        raise ValueError('GN_OUT_CONFIGS must be one directory name')
    return {'AC_TARGET_OS': target_os, 'AC_TARGET_CPU': target_cpu, 'GN_OUT_CONFIGS': output,
            'AC_CHROMIUM_TARGET': 'chrome_framework' if target_os == 'mac' else 'chrome',
            'AC_CHROMIUM_BINARY': 'Chromium Framework.framework' if target_os == 'mac' else 'chrome'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--platform', choices=('mac', 'linux'))
    parser.add_argument('--cpu', choices=('arm64', 'x64'))
    parser.add_argument('--shell', action='store_true')
    args = parser.parse_args()
    try:
        config = configuration(args.platform, args.cpu)
    except ValueError as error:
        parser.error(str(error))
    if args.shell:
        print('\n'.join(f'export {key}={shlex.quote(value)}' for key, value in config.items()))
    else:
        print(json.dumps(config, sort_keys=True))


if __name__ == '__main__':
    main()
