import contextlib
import errno
import fcntl
import hashlib
import json
import os
import re
import socket
import stat
import struct
from pathlib import Path

DIR_NAME = "Browse"
SESSION_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
SOL_LOCAL = 0
LOCAL_PEERCRED = 1
XUCRED_SIZE = 76
MAX_META = 64 * 1024


class PathError(Exception):
    pass


def check_name(kind: str, name: str) -> str:
    if not isinstance(name, str) or not SESSION_NAME.match(name):
        raise PathError(f"{kind} must be 1 to 64 letters, digits, '.', '_' or '-', starting with a letter or digit")
    return name


def session_key(namespace: str, endpoint_key: str, session: str) -> str:
    raw = f"{namespace}\0{endpoint_key}\0{session}".encode()
    return hashlib.sha256(raw).hexdigest()[:24]


def _check_dir(fd: int, label: str) -> None:
    info = os.fstat(fd)
    if not stat.S_ISDIR(info.st_mode):
        raise PathError(f"{label} isn't a folder")
    if info.st_uid != os.getuid():
        raise PathError(f"{label} belongs to another user")
    if stat.S_IMODE(info.st_mode) & 0o077:
        raise PathError(f"{label} must be private (mode 0700)")


def _open_dir(path: str, dir_fd: int | None = None) -> int:
    try:
        return os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=dir_fd)
    except OSError as error:
        if error.errno in (errno.ELOOP, errno.ENOTDIR):
            raise PathError(f"{path} is a symbolic link or not a folder") from None
        raise


def open_private(root: Path, *parts: str, create: bool = True) -> int:
    try:
        fd = _open_dir(str(root))
    except FileNotFoundError:
        raise PathError(f"{root} doesn't exist") from None
    try:
        info = os.fstat(fd)
        if info.st_uid != os.getuid():
            raise PathError(f"{root} belongs to another user")
        for part in parts:
            if create:
                with contextlib.suppress(FileExistsError):
                    os.mkdir(part, 0o700, dir_fd=fd)
            child = _open_dir(part, fd)
            os.close(fd)
            fd = child
            _check_dir(fd, part)
        return fd
    except BaseException:
        os.close(fd)
        raise


def open_private_dirat(dir_fd: int, name: str, create: bool = True) -> int:
    if create:
        with contextlib.suppress(FileExistsError):
            os.mkdir(name, 0o700, dir_fd=dir_fd)
    fd = _open_dir(name, dir_fd)
    try:
        _check_dir(fd, name)
    except BaseException:
        os.close(fd)
        raise
    return fd


def browse_dir(root: Path, create: bool = True) -> int:
    return open_private(root, DIR_NAME, create=create)


@contextlib.contextmanager
def inside(dir_fd: int):
    here = os.open(".", os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fchdir(dir_fd)
        yield
    finally:
        os.fchdir(here)
        os.close(here)


def open_private_file(name: str, dir_fd: int, flags: int = os.O_RDWR | os.O_CREAT, mode: int = 0o600) -> int:
    fd = os.open(name, flags | os.O_NOFOLLOW | os.O_CLOEXEC, mode, dir_fd=dir_fd)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
            raise PathError(f"{name} isn't a regular file of yours")
        if stat.S_IMODE(info.st_mode) & 0o077:
            os.fchmod(fd, 0o600)
        return fd
    except BaseException:
        os.close(fd)
        raise


def take_lock(name: str, dir_fd: int, blocking: bool = False) -> int | None:
    fd = open_private_file(name, dir_fd)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
    except BlockingIOError:
        os.close(fd)
        return None
    except BaseException:
        os.close(fd)
        raise
    return fd


def lock_held(name: str, dir_fd: int) -> bool:
    try:
        fd = open_private_file(name, dir_fd, os.O_RDONLY)
    except (FileNotFoundError, PathError):
        return False
    try:
        fcntl.flock(fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
    except BlockingIOError:
        return True
    finally:
        os.close(fd)
    return False


def socket_is_ours(name: str, dir_fd: int) -> tuple[int, int] | None:
    try:
        info = os.lstat(name, dir_fd=dir_fd)
    except FileNotFoundError:
        return None
    if not stat.S_ISSOCK(info.st_mode):
        raise PathError(f"{name} isn't a socket")
    if info.st_uid != os.getuid():
        raise PathError(f"{name} belongs to another user")
    if stat.S_IMODE(info.st_mode) & 0o077:
        raise PathError(f"{name} must be mode 0600")
    return info.st_dev, info.st_ino


def peer_uid(sock: socket.socket) -> int | None:
    try:
        raw = sock.getsockopt(SOL_LOCAL, LOCAL_PEERCRED, XUCRED_SIZE)
    except OSError:
        return None
    if len(raw) < 8:
        return None
    return struct.unpack_from("<II", raw)[1]


def write_private_json(name: str, dir_fd: int, value) -> None:
    temp = f".{name}.{os.getpid()}.tmp"
    fd = open_private_file(temp, dir_fd, os.O_WRONLY | os.O_CREAT | os.O_TRUNC)
    try:
        os.write(fd, json.dumps(value, ensure_ascii=False).encode())
    finally:
        os.close(fd)
    os.rename(temp, name, src_dir_fd=dir_fd, dst_dir_fd=dir_fd)


def read_private_json(name: str, dir_fd: int, default=None):
    try:
        fd = open_private_file(name, dir_fd, os.O_RDONLY)
    except FileNotFoundError:
        return default
    try:
        raw = os.read(fd, MAX_META + 1)
    finally:
        os.close(fd)
    if len(raw) > MAX_META:
        raise PathError(f"{name} is too large")
    try:
        return json.loads(raw)
    except ValueError:
        return default


def unlink_quietly(name: str, dir_fd: int) -> None:
    with contextlib.suppress(FileNotFoundError):
        os.unlink(name, dir_fd=dir_fd)
