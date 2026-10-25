#!/usr/bin/env python3
"""Where a write really lands, for every engine build tool: one resolver for paths and one lock check.

The protected set is the real ~/chromium-build (found through the account, never $HOME), its Chromium tree, the
tree's out/ and series-base, each identified by device and inode. A path that is one of them, lies inside one, or
contains one (after resolving every symlink on the way) needs the genuine chromium lock: a live lockf above the caller
holding /tmp/ac-chromium.lockf right now. A scratch destination must not reach outside itself through a symlink or
share a file with anything through a hard link.

  pathguard.py classify PATH…        exit 0: every PATH is scratch; 10: one reaches the protected set (says which)
  pathguard.py build-root CB         exit 0: CB and the paths a step writes under it stay inside CB and are scratch;
                                     10: CB is (or reaches) the real build root; 2: a path under CB escapes CB
  pathguard.py lock-held             exit 0 when the caller holds the chromium lock (AC_LOCK_ROOT's)
"""
import os
import pwd
import stat
import subprocess
import sys

STEP_TARGETS = ['chromium_git', 'chromium_git/chromium', 'chromium_git/chromium/src',
                'chromium_git/chromium/src/out', 'chromium_git/chromium/src/out/Release_GN_arm64',
                'chromium_git/chromium/src/out/Release_GN_x64',
                'chromium_git/chromium/src/components/neterror/resources/game', 'series-base', 'scripts', 'logs',
                'depot_tools', 'domsubcache.tar.gz']


def real_chromium_build():
    return os.path.realpath(os.path.join(pwd.getpwuid(os.getuid()).pw_dir, 'chromium-build'))


def identity(path):
    st = os.stat(path)
    return (st.st_dev, st.st_ino)


def existing(path):
    path = os.path.abspath(path)
    while not os.path.lexists(path):
        parent = os.path.dirname(path)
        if parent == path:
            break
        path = parent
    return os.path.realpath(path)


def chain(path):
    out, current = [], path
    while True:
        try:
            out.append(identity(current))
        except OSError:
            pass
        parent = os.path.dirname(current)
        if parent == current:
            return out
        current = parent


def protected():
    cb = real_chromium_build()
    src = os.path.join(cb, 'chromium_git/chromium/src')
    out = []
    for p in (cb, src, os.path.join(src, 'out'), os.path.join(cb, 'series-base')):
        if os.path.exists(p):
            out.append((p, identity(p), chain(os.path.realpath(p))))
    return out


def reaches(path):
    resolved = existing(path)
    up = chain(resolved)
    exists = os.path.lexists(os.path.abspath(path))
    here = identity(resolved) if exists else None
    for name, ident, above in protected():
        if ident in up:
            return name
        if here is not None and here in above:
            return name
    return None


def overlaps(path, other):
    if not os.path.lexists(other):
        return False
    other_id, other_up = identity(other), chain(os.path.realpath(other))
    if other_id in chain(existing(path)):
        return True
    return os.path.lexists(os.path.abspath(path)) and identity(existing(path)) in other_up


def chromium_lock_held():
    kernel = os.path.realpath(os.path.join(os.environ.get('AC_LOCK_ROOT', '/tmp'), 'ac-chromium.lockf'))
    pid, seen = os.getpid(), set()
    while pid > 1 and pid not in seen:
        seen.add(pid)
        line = subprocess.run(['ps', '-o', 'ppid=,command=', '-p', str(pid)], capture_output=True,
                              text=True).stdout.strip()
        ppid, _, command = line.partition(' ')
        if not ppid.isdigit():
            return False
        argv = command.split()
        if argv and os.path.basename(argv[0]) == 'lockf':
            args = iter(argv[1:])
            held = None
            for arg in args:
                if arg == '-t':
                    next(args, None)
                elif not arg.startswith('-'):
                    held = arg
                    break
            if held and os.path.realpath(held) == kernel:
                probe = subprocess.run(['lockf', '-s', '-k', '-t', '0', kernel, 'true'], capture_output=True)
                return probe.returncode != 0
        pid = int(ppid)
    return False


def real_lock_held():
    root = os.path.realpath(os.environ.get('AC_LOCK_ROOT', '/tmp'))
    return root == os.path.realpath('/tmp') and chromium_lock_held()


def require_writable(paths, what):
    for path in paths:
        hit = reaches(path)
        if hit and not real_lock_held():
            sys.exit(f'{what}: {path} reaches {hit} (the real ~/chromium-build): hold the real chromium lock '
                     f'(scripts/agent/locked chromium --as <you> -- ...) and leave AC_LOCK_ROOT unset')


def aliases_under(root, rels=None):
    root_real = os.path.realpath(root)
    problems = []

    def check_component(path):
        try:
            st = os.lstat(path)
        except FileNotFoundError:
            return False
        if stat.S_ISLNK(st.st_mode):
            target = os.path.realpath(path)
            if not (target == root_real or target.startswith(root_real + os.sep)):
                problems.append(f'{path} is a symlink out of {root_real} (to {target})')
            elif reaches(target):
                problems.append(f'{path} reaches the real ~/chromium-build')
        elif stat.S_ISREG(st.st_mode) and st.st_nlink > 1:
            problems.append(f'{path} is hard-linked ({st.st_nlink} links)')
        return True

    if rels is None:
        for top, dirs, files in os.walk(root_real):
            for name in dirs + files:
                check_component(os.path.join(top, name))
            if len(problems) > 20:
                break
    else:
        for rel in rels:
            current = root_real
            for part in rel.split('/'):
                current = os.path.join(current, part)
                if not check_component(current):
                    break
    return problems


def require_scratch_destination(root, what, rels=None):
    hit = reaches(root)
    if hit:
        sys.exit(f'{what}: {root} reaches {hit} (the real ~/chromium-build): a scratch copy can\'t go there')
    problems = aliases_under(root, rels)
    if problems:
        sys.exit(f'{what}: {root} has aliases: ' + '; '.join(problems[:10]))


def require_tree_writable(root, rels, what):
    if reaches(root):
        require_writable([root], what)
        return
    problems = aliases_under(root, rels)
    if problems:
        sys.exit(f'{what}: {root} has aliases: ' + '; '.join(problems[:10]))


def main():
    command, args = sys.argv[1], sys.argv[2:]
    if command == 'classify':
        for path in args:
            hit = reaches(path)
            if hit:
                print(f'{path} reaches {hit}')
                return 10
        return 0
    if command == 'build-root':
        cb = args[0]
        if reaches(cb):
            print(f'{cb} reaches the real ~/chromium-build')
            return 10
        cb_real = os.path.realpath(cb)
        for rel in STEP_TARGETS:
            path = os.path.join(cb, rel)
            hit = reaches(path)
            if hit:
                print(f'{path} reaches {hit}')
                return 10
            resolved = existing(path)
            if not (resolved == cb_real or resolved.startswith(cb_real + os.sep)):
                print(f'{path} escapes {cb_real} (to {resolved})')
                return 2
        return 0
    if command == 'lock-held':
        return 0 if chromium_lock_held() else 1
    print(__doc__)
    return 64


if __name__ == '__main__':
    sys.exit(main())
