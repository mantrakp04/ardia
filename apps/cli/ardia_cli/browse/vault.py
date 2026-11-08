import asyncio
import getpass
import os
import re
import subprocess
import sys
import time
from urllib.parse import urlsplit

from ardia_cli.browse import paths
from ardia_cli.browse.errors import BrowseError, Usage

SECURITY = "/usr/bin/security"
SERVICE = "dev.ardia.browse.auth"
LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1", "[::1]"}
SECURITY_TIMEOUT = 20


def keychain_args() -> list[str]:
    path = os.environ.get("ARDIA_BROWSE_KEYCHAIN")
    return [path] if path else []


def quote(value: str) -> str:
    if any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise BrowseError("Secrets and names can't contain control characters or line breaks")
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def security(words: list[str]) -> tuple[int, str]:
    line = " ".join(quote(word) if index else word for index, word in enumerate(words)) + "\n"
    try:
        done = subprocess.run([SECURITY, "-i"], input=line.encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              timeout=SECURITY_TIMEOUT, close_fds=True)
    except subprocess.TimeoutExpired:
        raise BrowseError("The Keychain didn't answer in time (is a Keychain prompt waiting?)") from None
    except OSError as error:
        raise BrowseError(f"Couldn't run {SECURITY}: {error.strerror}") from None
    failed = b"returned -" in done.stderr or b"could not be found" in done.stderr
    return (1 if failed else done.returncode), done.stdout.decode("utf-8", "replace")


def store_secret(name: str, password: str) -> None:
    code, _ = security(["add-generic-password", "-U", "-a", name, "-s", SERVICE, "-l", f"Ardia browse: {name}", "-w", password, *keychain_args()])
    if code:
        raise BrowseError("The Keychain refused to save the password")


def read_secret(name: str, utf8: bool) -> str:
    code, output = security(["find-generic-password", "-a", name, "-s", SERVICE, "-w", *keychain_args()])
    if code:
        raise BrowseError(f"No password for {name} in the Keychain; save it again with `ardia browse auth save {name} ...`")
    value = output[:-1] if output.endswith("\n") else output
    if utf8 and re.fullmatch(r"(?:[0-9a-f]{2})+", value):
        value = bytes.fromhex(value).decode("utf-8")
    return value


def delete_secret(name: str) -> None:
    security(["delete-generic-password", "-a", name, "-s", SERVICE, *keychain_args()])


def origin_of(url: str) -> str:
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    if parts.scheme == "https" or (parts.scheme == "http" and host in LOOPBACK_HOSTS):
        port = f":{parts.port}" if parts.port else ""
        return f"{parts.scheme}://{host}{port}"
    raise BrowseError(f"A credential is bound to https origins (http only for localhost); {url} isn't one")


def auth_dir(root) -> int:
    browse = paths.browse_dir(root)
    try:
        return paths.open_private_dirat(browse, "auth")
    finally:
        os.close(browse)


def load_meta(root, name: str) -> dict:
    paths.check_name("An auth profile name", name)
    folder = auth_dir(root)
    try:
        meta = paths.read_private_json(f"{name}.json", folder)
    finally:
        os.close(folder)
    if not meta:
        raise BrowseError(f"No auth profile named {name}; run `ardia browse auth list`")
    return meta


def read_password(options: dict, stdin_reader) -> str:
    if options.get("password"):
        raise Usage("--password puts the secret on the command line (visible in ps and shell history); use --password-stdin or answer the prompt")
    if options.get("password_stdin"):
        text = stdin_reader()
        if text.endswith("\n"):
            text = text[:-1]
        if text.endswith("\r"):
            text = text[:-1]
    elif sys.stdin.isatty():
        text = getpass.getpass("Password: ")
    else:
        raise Usage("Give the password with --password-stdin (stdin isn't a terminal, so there's no prompt)")
    if not text:
        raise Usage("The password is empty")
    return text


def save(root, name: str, options: dict, stdin_reader) -> dict:
    paths.check_name("An auth profile name", name)
    if not options.get("url"):
        raise Usage("Usage: ardia browse auth save <name> --url <https url> --username <user> [--password-stdin]")
    origins = [origin_of(options["url"])] + [origin_of(value) for value in options.get("origin") or []]
    password = read_password(options, stdin_reader)
    meta = {
        "name": name,
        "url": options["url"],
        "origins": sorted(set(origins)),
        "username": options.get("username"),
        "usernameSelector": options.get("username_selector"),
        "passwordSelector": options.get("password_selector"),
        "submitSelector": options.get("submit_selector"),
        "utf8": any(ord(char) > 126 for char in password),
        "savedAt": int(time.time()),
    }
    store_secret(name, password)
    del password
    folder = auth_dir(root)
    try:
        paths.write_private_json(f"{name}.json", folder, meta)
    finally:
        os.close(folder)
    return meta


def listing(root) -> list[dict]:
    folder = auth_dir(root)
    try:
        rows = []
        for entry in sorted(os.listdir(folder)):
            if entry.endswith(".json") and not entry.startswith("."):
                meta = paths.read_private_json(entry, folder)
                if meta:
                    rows.append(public(meta))
        return rows
    finally:
        os.close(folder)


def public(meta: dict) -> dict:
    return {key: meta.get(key) for key in ("name", "url", "origins", "username", "usernameSelector", "passwordSelector", "submitSelector", "savedAt")}


def delete(root, name: str) -> None:
    load_meta(root, name)
    delete_secret(name)
    folder = auth_dir(root)
    try:
        paths.unlink_quietly(f"{name}.json", folder)
    finally:
        os.close(folder)


async def login(ctx, argv):
    from ardia_cli.browse import actions, plugins
    from ardia_cli.browse.commands import Result, current_or_new, navigate, parse, wait_until

    options, args = parse(argv, {"--url": "value", "--username-selector": "value", "--password-selector": "value", "--submit-selector": "value",
                                 "--credential-provider": "value", "--item": "value", "--no-humanize": "bool"})
    if not args:
        raise Usage("Usage: ardia browse auth login <name> [--username-selector S] [--password-selector S] [--submit-selector S]")
    name = args[0]
    root = ctx.state.config["data_root"]
    if options.get("credential_provider"):
        creds = await asyncio.to_thread(plugins.credential, root, options["credential_provider"], options.get("item") or name, options.get("url"))
        url = options.get("url") or creds.get("url")
        if not url:
            raise BrowseError("The credential provider gave no URL; pass --url")
        meta = {"url": url, "origins": [origin_of(url)], "username": creds.get("username"), "usernameSelector": creds.get("usernameSelector"),
                "passwordSelector": creds.get("passwordSelector"), "submitSelector": creds.get("submitSelector")}
        password = creds.get("password") or ""
    else:
        meta = load_meta(root, name)
        password = await asyncio.to_thread(read_secret, name, bool(meta.get("utf8")))
    for key in ("username_selector", "password_selector", "submit_selector"):
        camel = key.split("_")[0] + "Selector"
        if options.get(key):
            meta[camel] = options[key]
    humanize = ctx.humanize and not options.get("no_humanize")
    origins = set(meta["origins"])
    page = await current_or_new(ctx)
    await page.refresh_frames()
    if (page.frames.get(page.main_frame, {}).get("origin") or "") not in origins:
        await navigate(ctx, page, meta["url"])
    password_selector = meta.get("passwordSelector") or "input[type=password]"

    async def password_field():
        try:
            found_page, element = await ctx.state.locate(password_selector, page)
        except BrowseError:
            return None
        visible = await found_page.call("(el) => ardiaBrowse.visible(el)", element, frame=element.frame)
        return element if visible else None

    password_element = await wait_until(password_field, ctx.timeout, 0.2, "the password field")
    username_element = None
    if meta.get("username"):
        if meta.get("usernameSelector"):
            _, username_element = await ctx.state.locate(meta["usernameSelector"], page)
        else:
            remote = await page.call(
                "(pw) => { const inputs = Array.from(document.querySelectorAll('input')).filter((i) => ardiaBrowse.visible(i) && !i.disabled);"
                " const named = inputs.find((i) => /username|email/.test(i.autocomplete || '')); if (named) return named;"
                " const before = inputs.filter((i) => i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING && /^(text|email|tel|)$/.test(i.type));"
                " return before.length ? before[before.length - 1] : null; }",
                password_element, frame=password_element.frame, by_value=False,
            )
            username_element = await page.element_from(remote, password_element.frame, "the username field")
    await page.refresh_frames()
    frame = password_element.frame
    expected = (page.loader(page.main_frame), page.loader(frame))
    frame_origin = page.frames.get(frame, {}).get("origin")
    top_origin = page.frames.get(page.main_frame, {}).get("origin")
    if frame_origin not in origins or top_origin not in origins:
        raise BrowseError(f"Refusing to type {name}'s credentials: the page is {top_origin or 'unknown'}"
                          f"{'' if frame == page.main_frame else ' with the field in ' + str(frame_origin)}, not {', '.join(sorted(origins))}")
    navigations = page.navigations

    def make_guard(element):
        async def guard():
            await page.refresh_frames()
            if page.navigations != navigations or (page.loader(page.main_frame), page.loader(frame)) != expected \
                    or page.frames.get(frame, {}).get("origin") not in origins:
                raise BrowseError(f"Stopped typing {name}'s credentials: the page navigated or the frame changed")
            focused = await page.call("(el) => document.activeElement === el || el.contains(document.activeElement)", element, frame=frame)
            if not focused:
                raise BrowseError(f"Stopped typing {name}'s credentials: focus left the field")
            if frame != page.main_frame:
                owner = (await page.send("DOM.getFrameOwner", {"frameId": frame}))["backendNodeId"]
                owner_element = await page.resolve_backend(owner, page.main_frame, "the field's frame")
                top_focus = owner_element is not None and await page.call("(el) => document.activeElement === el", owner_element, frame=page.main_frame)
                if not top_focus:
                    raise BrowseError(f"Stopped typing {name}'s credentials: focus left the field's frame")

        return guard

    async def type_guarded(element, text):
        info = await page.call("(el) => ardiaBrowse.info(el)", element, frame=frame)
        await actions.focus_field(page, element, info, humanize)
        await actions.clear_field(page, element, humanize)
        guard = make_guard(element)
        keyboard = page.input.keyboard(element=element, guard=guard)

        async def run():
            for char in text:
                await keyboard._type_char(char, None if humanize else 0)
                if humanize:
                    await keyboard._apply_realistic_delay(char)

        await actions.expect_input(page, frame, lambda: page.input.gesture("auth login", run), {"keydown": len(text)}, "The typing")

    try:
        if username_element is not None:
            await type_guarded(username_element, meta["username"])
        await type_guarded(password_element, password)
    finally:
        password = None
    if meta.get("submitSelector"):
        _, submit = await ctx.state.locate(meta["submitSelector"], page)
        await actions.click(page, submit, humanize)
    else:
        await actions.expect_input(page, frame, lambda: page.input.gesture("auth login", lambda: page.input.press_combo("Enter", humanize)), {"keydown": 1}, "The Enter press")
    return Result({"name": name, "loggedIn": True, "url": page.url}, f"✓ Logged in as {meta.get('username') or name}")
