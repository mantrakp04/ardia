#!/usr/bin/env python3
import os
import pathlib
import shutil
import stat
import sys
import tempfile

import pathguard


def main():
    if not pathguard.chromium_lock_held():
        sys.exit('normalize-sysroot.py: hold the chromium lock')
    source = pathlib.Path(sys.argv[1]).resolve(strict=True)
    pathguard.require_tree_writable(str(source), ['build/linux'], 'normalize-sysroot.py')
    count = 0
    for sysroot in (source / 'build/linux').glob('*-sysroot'):
        if sysroot.is_symlink() or not sysroot.is_dir():
            continue
        for directory, _, files in os.walk(sysroot, followlinks=False):
            for name in files:
                target = pathlib.Path(directory) / name
                metadata = target.lstat()
                if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink < 2:
                    continue
                descriptor, temporary = tempfile.mkstemp(dir=directory)
                os.close(descriptor)
                try:
                    shutil.copy2(target, temporary)
                    os.replace(temporary, target)
                finally:
                    if os.path.exists(temporary):
                        os.unlink(temporary)
                count += 1
    print(f'Normalized {count} sysroot hard links')


if __name__ == '__main__':
    main()
