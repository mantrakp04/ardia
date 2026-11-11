import asyncio
import base64
import json
import logging
import os
import secrets
import shutil
import time
from pathlib import Path

from ardia_cli.browse import claims
from ardia_cli.browse.commands import Result, command, glob_match, need, normalize_url, parse
from ardia_cli.browse.errors import BrowseError, Gated, Usage

BODY_LIMIT = 1024 * 1024
HAR_BODY_LIMIT = 2 * 1024 * 1024
HAR_TOTAL_LIMIT = 64 * 1024 * 1024
TRACE_EVENT_LIMIT = 2_000_000
STREAM_CLIENTS = 4
TEXT_TYPES = ("text/", "application/json", "application/javascript", "application/xml", "application/x-javascript", "+json", "+xml")
DEFAULT_CATEGORIES = [
    "-*", "devtools.timeline", "v8.execute", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame",
    "toplevel", "blink.console", "blink.user_timing", "latencyInfo", "disabled-by-default-devtools.timeline.stack",
    "disabled-by-default-v8.cpu_profiler",
]


def held_claims(ctx) -> set:
    return ctx.state.extras.setdefault("claims", set())


def claim(ctx, page, kind):
    config = ctx.state.config
    claims.claim(config["browse_fd"], config["key"], ctx.state.session, page.target_id, kind)
    held_claims(ctx).add((page.target_id, kind))


def release_claim(ctx, target_id: str, kind: str):
    config = ctx.state.config
    held_claims(ctx).discard((target_id, kind))
    claims.release(config["browse_fd"], config["key"], target_id, kind)


async def activate(ctx, page, kind: str, enable):
    fresh = (page.target_id, kind) not in held_claims(ctx)
    claim(ctx, page, kind)
    try:
        return await enable()
    except BaseException:
        if fresh:
            release_claim(ctx, page.target_id, kind)
        raise


@command("console")
async def cmd_console(ctx, argv):
    options, _ = parse(argv, {"--clear": "bool"})
    page = await ctx.state.page()
    started = not page.runtime_on
    await activate(ctx, page, "console", page.enable_runtime)
    ctx.state.leases.add("console")
    if started:
        await asyncio.sleep(0.2)
    messages = list(page.console.items)
    dropped = page.console.dropped
    if options.get("clear"):
        page.console.clear()
        return Result({"cleared": True}, "✓ Console cleared")
    lines = [f"[{message['type']}] {message['text']}" for message in messages]
    if dropped:
        lines.insert(0, f"({dropped} older messages dropped)")
    if started and not messages:
        lines.append("Console capture started; messages from now on are kept (Runtime is on for this tab until the session ends)")
    return Result({"messages": messages, "dropped": dropped, "started": started}, "\n".join(lines) or "(no console messages)", page_content=True)


@command("errors")
async def cmd_errors(ctx, argv):
    options, _ = parse(argv, {"--clear": "bool"})
    page = await ctx.state.page()
    started = not page.runtime_on
    await activate(ctx, page, "console", page.enable_runtime)
    ctx.state.leases.add("console")
    if started:
        await asyncio.sleep(0.2)
    errors = list(page.errors.items)
    if options.get("clear"):
        page.errors.clear()
        return Result({"cleared": True}, "✓ Errors cleared")
    lines = [error["text"] for error in errors]
    if page.errors.dropped:
        lines.insert(0, f"({page.errors.dropped} older errors dropped)")
    if started and not errors:
        lines.append("Error capture started; uncaught errors from now on are kept")
    return Result({"errors": errors, "dropped": page.errors.dropped, "started": started}, "\n".join(lines) or "(no errors)", page_content=True)


def status_matches(status, wanted: str) -> bool:
    if status is None:
        return False
    wanted = wanted.strip().lower()
    if wanted.endswith("xx") and len(wanted) == 3:
        return str(status)[0] == wanted[0]
    if "-" in wanted:
        low, high = wanted.split("-", 1)
        return int(low) <= int(status) <= int(high)
    return str(status) == wanted


def request_row(record):
    return {key: record.get(key) for key in ("requestId", "url", "method", "headers", "resourceType", "status", "mimeType", "responseHeaders", "timestamp", "failed")
            if record.get(key) is not None}


@command("network")
async def cmd_network(ctx, argv):
    if not argv:
        raise Usage("Usage: ardia browse network route|unroute|requests|request|har ...")
    action, rest = argv[0], argv[1:]
    if action == "requests":
        return await network_requests(ctx, rest)
    if action == "request":
        return await network_request(ctx, rest)
    if action == "har":
        return await network_har(ctx, rest)
    if action == "route":
        return await network_route(ctx, rest)
    if action == "unroute":
        return await network_unroute(ctx, rest)
    raise Usage(f"Unknown network subcommand: {action}")


async def network_requests(ctx, argv):
    options, _ = parse(argv, {"--clear": "bool", "--filter": "value", "--type": "value", "--method": "value", "--status": "value"})
    page = await ctx.state.page()
    started = not page.network_on
    await activate(ctx, page, "network", page.enable_network)
    ctx.state.leases.add("network")
    if options.get("clear"):
        page.requests.clear()
        page.requests_dropped = 0
        return Result({"cleared": True}, "✓ Request log cleared")
    rows = list(page.requests.values())
    if options.get("filter"):
        rows = [row for row in rows if options["filter"] in row.get("url", "") or glob_match(options["filter"], row.get("url", ""))]
    if options.get("type"):
        types = {value.strip().lower() for value in options["type"].split(",")}
        rows = [row for row in rows if str(row.get("resourceType", "")).lower() in types]
    if options.get("method"):
        rows = [row for row in rows if row.get("method", "").upper() == options["method"].upper()]
    if options.get("status"):
        rows = [row for row in rows if status_matches(row.get("status"), options["status"])]
    lines = [f"[{row['requestId']}] {row.get('method')} {row.get('url')} ({row.get('resourceType')}) {row.get('status') or row.get('failed') or 'pending'}" for row in rows]
    if started and not rows:
        lines.append("Network capture started; requests from now on are kept")
    return Result({"requests": [request_row(row) for row in rows], "dropped": page.requests_dropped, "started": started},
                  "\n".join(lines) or "(no requests)", page_content=True)


async def response_body(page, request_id, limit):
    try:
        body = await page.send("Network.getResponseBody", {"requestId": request_id})
    except BrowseError:
        return None, False
    text = body.get("body") or ""
    encoded = bool(body.get("base64Encoded"))
    if len(text) > limit:
        return text[:limit], encoded
    return text, encoded


async def network_request(ctx, argv):
    _, args = parse(argv)
    need(args, 1, "network request <requestId>")
    page = await ctx.state.page()
    record = page.requests.get(args[0])
    if record is None:
        raise BrowseError(f"No captured request {args[0]}; run `ardia browse network requests` first")
    detail = request_row(record)
    detail["postData"] = record.get("postData")
    body, encoded = await response_body(page, args[0], BODY_LIMIT)
    detail["body"] = body
    detail["base64Encoded"] = encoded
    lines = [f"{record.get('method')} {record.get('url')}", f"status: {record.get('status')} {record.get('statusText', '')}".rstrip(), "request headers:"]
    lines += [f"  {key}: {value}" for key, value in (record.get("headers") or {}).items()]
    lines.append("response headers:")
    lines += [f"  {key}: {value}" for key, value in (record.get("responseHeaders") or {}).items()]
    if body is not None:
        lines += ["body:", body if not encoded else f"(base64, {len(body)} chars)"]
    return Result(detail, "\n".join(lines), page_content=True)


async def network_har(ctx, argv):
    options, args = parse(argv, {"--content": "value"})
    need(args, 1, "network har start|stop [path]")
    page = await ctx.state.page()
    if args[0] == "start":
        mode = options.get("content") or "text"
        if mode not in ("text", "all", "none"):
            raise Usage("--content takes text, all or none")
        await activate(ctx, page, "har", page.enable_network)
        ctx.state.leases.add("har")
        ctx.state.extras["har"] = {"target": page.target_id, "since": time.time() * 1000, "mode": mode, "seen": set(page.requests)}
        return Result({"started": True, "content": mode}, "✓ HAR recording started")
    if args[0] != "stop":
        raise Usage("Usage: ardia browse network har start|stop [path]")
    har = ctx.state.extras.pop("har", None)
    ctx.state.leases.discard("har")
    if not har:
        raise BrowseError("No HAR recording is running; start one with `ardia browse network har start`")
    release_claim(ctx, har["target"], "har")
    entries = []
    total = 0
    for request_id, record in list(page.requests.items()):
        if request_id in har["seen"]:
            continue
        content = {"size": record.get("encodedDataLength") or 0, "mimeType": record.get("mimeType", "")}
        textual = any(marker in content["mimeType"] for marker in TEXT_TYPES)
        if har["mode"] != "none" and record.get("finished") and (textual or har["mode"] == "all") and total < HAR_TOTAL_LIMIT:
            body, encoded = await response_body(page, request_id, HAR_BODY_LIMIT)
            if body is not None:
                content["text"] = body
                total += len(body)
                if encoded:
                    content["encoding"] = "base64"
        entries.append({
            "startedDateTime": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime((record.get("timestamp") or 0) / 1000)) + f".{int(record.get('timestamp') or 0) % 1000:03d}Z",
            "time": max(0, ((record.get("finished") or 0) - (record.get("monotonic") or 0)) * 1000) if record.get("finished") else 0,
            "request": {"method": record.get("method"), "url": record.get("url"), "httpVersion": record.get("protocol") or "",
                        "headers": [{"name": k, "value": v} for k, v in (record.get("headers") or {}).items()], "queryString": [], "cookies": [],
                        "headersSize": -1, "bodySize": len(record.get("postData") or ""),
                        **({"postData": {"mimeType": (record.get("headers") or {}).get("Content-Type", ""), "text": record["postData"]}} if record.get("postData") else {})},
            "response": {"status": record.get("status") or 0, "statusText": record.get("statusText", ""), "httpVersion": record.get("protocol") or "",
                         "headers": [{"name": k, "value": v} for k, v in (record.get("responseHeaders") or {}).items()], "cookies": [],
                         "content": content, "redirectURL": (record.get("responseHeaders") or {}).get("location", ""), "headersSize": -1,
                         "bodySize": record.get("encodedDataLength") or -1},
            "cache": {}, "timings": {"send": 0, "wait": 0, "receive": 0},
            "_resourceType": record.get("resourceType"),
            **({"_error": record["failed"]} if record.get("failed") else {}),
        })
    document = {"log": {"version": "1.2", "creator": {"name": "ardia browse", "version": "1"}, "pages": [], "entries": entries}}
    path = ctx.path(args[1]) if len(args) > 1 else os.path.join(os.path.dirname(default_dir(ctx)), f"capture-{int(time.time())}.har")
    Path(path).write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
    shown = args[1] if len(args) > 1 else path
    note = " (Ardia strips Cookie, Set-Cookie and Authorization headers on the token path)" if not ctx.state.endpoint.explicit else ""
    return Result({"path": shown, "entries": len(entries)}, f"✓ HAR saved to {shown} ({len(entries)} entries){note}")


def default_dir(ctx):
    from ardia_cli.browse.media import default_path

    return default_path(ctx, "png")


async def network_route(ctx, argv):
    options, args = parse(argv, {"--abort": "bool", "--body": "value", "--resource-type": "value", "--status": "value", "--content-type": "value"})
    need(args, 1, "network route <url> [--abort | --body <json>] [--resource-type <csv>]")
    page = await ctx.state.page()
    from ardia_cli.browse.commands import refuse_on_borrowed

    refuse_on_borrowed(ctx, page, "reroute the requests of")
    routes = ctx.state.extras.setdefault("routes", [])
    route = {"pattern": args[0], "abort": bool(options.get("abort")), "body": options.get("body"),
             "types": {value.strip().lower() for value in options["resource_type"].split(",")} if options.get("resource_type") else None,
             "status": int(options.get("status") or 200), "contentType": options.get("content_type")}
    async def enable():
        try:
            await page.send("Fetch.enable", {"patterns": [{"urlPattern": "*", "requestStage": "Request"}]})
        except Gated as error:
            raise error.during("network route") from None

    await activate(ctx, page, "route", enable)
    routes.append(route)
    ctx.state.leases.add("route")
    install_router(ctx, page)
    return Result({"routed": args[0], "abort": route["abort"]}, f"✓ Routing {args[0]}")


async def enable_credentials(ctx, page, username, password):
    async def enable():
        try:
            await page.send("Fetch.enable", {"patterns": [{"urlPattern": "*", "requestStage": "Request"}], "handleAuthRequests": True})
        except Gated as error:
            raise error.during("set credentials", "HTTP auth answers Fetch.authRequired") from None

    await activate(ctx, page, "route", enable)
    ctx.state.extras["credentials"] = {"username": username, "password": password}
    ctx.state.leases.add("route")
    install_router(ctx, page)


async def handle_auth(ctx, page, params):
    credentials = ctx.state.extras.get("credentials")
    response = {"response": "ProvideCredentials", **credentials} if credentials else {"response": "Default"}
    try:
        await page.send("Fetch.continueWithAuth", {"requestId": params.get("requestId"), "authChallengeResponse": response})
    except BrowseError:
        pass


def install_router(ctx, page):
    if ctx.state.extras.get("router"):
        return

    def listener(event_page, method, params):
        if method == "Fetch.requestPaused" and event_page is not None:
            asyncio.ensure_future(handle_paused(ctx, event_page, params))
        elif method == "Fetch.authRequired" and event_page is not None:
            asyncio.ensure_future(handle_auth(ctx, event_page, params))

    ctx.state.listeners.append(listener)
    ctx.state.extras["router"] = listener


async def handle_paused(ctx, page, params):
    request = params.get("request") or {}
    url = request.get("url", "")
    kind = str(params.get("resourceType", "")).lower()
    request_id = params.get("requestId")
    try:
        for route in reversed(ctx.state.extras.get("routes", [])):
            if route["types"] and kind not in route["types"]:
                continue
            if not (route["pattern"] in ("*", "**") or glob_match(route["pattern"], url)):
                continue
            if route["abort"]:
                await page.send("Fetch.failRequest", {"requestId": request_id, "errorReason": "BlockedByClient"})
                return
            if route["body"] is not None:
                body = route["body"]
                content_type = route["contentType"] or ("application/json" if body.strip()[:1] in ("{", "[") else "text/plain")
                await page.send("Fetch.fulfillRequest", {"requestId": request_id, "responseCode": route["status"],
                                                          "responseHeaders": [{"name": "Content-Type", "value": content_type}, {"name": "Access-Control-Allow-Origin", "value": "*"}],
                                                          "body": base64.b64encode(body.encode()).decode()})
                return
            break
        await page.send("Fetch.continueRequest", {"requestId": request_id})
    except BrowseError:
        pass


async def network_unroute(ctx, argv):
    _, args = parse(argv)
    routes = ctx.state.extras.get("routes", [])
    if args:
        routes[:] = [route for route in routes if route["pattern"] != args[0]]
    else:
        routes.clear()
    if not routes and not ctx.state.extras.get("credentials"):
        ctx.state.leases.discard("route")
        for target_id, kind in list(held_claims(ctx)):
            if kind == "route":
                release_claim(ctx, target_id, kind)
        for page in list(ctx.state.pages.values()):
            if page.session_id:
                try:
                    await page.send("Fetch.disable")
                except BrowseError:
                    pass
    return Result({"unrouted": args[0] if args else "all"}, "✓ Done")


async def tracing(ctx, argv, kind):
    options, args = parse(argv, {"--categories": "value"})
    need(args, 1, f"{kind} start|stop [path]")
    page = await ctx.state.page()
    if args[0] == "start":
        if ctx.state.extras.get("tracing"):
            raise BrowseError("A trace is already recording; stop it first")
        categories = options["categories"].split(",") if options.get("categories") else DEFAULT_CATEGORIES
        record = {"events": [], "done": asyncio.get_running_loop().create_future(), "target": page.target_id, "dropped": 0}

        def listener(event_page, method, params):
            if event_page is None or event_page.target_id != record["target"]:
                return
            if method == "Tracing.dataCollected":
                for event in params.get("value") or []:
                    if len(record["events"]) < TRACE_EVENT_LIMIT:
                        record["events"].append(event)
                    else:
                        record["dropped"] += 1
            elif method == "Tracing.tracingComplete" and not record["done"].done():
                record["done"].set_result(True)

        async def enable():
            try:
                await page.send("Tracing.start", {"traceConfig": {"includedCategories": [c for c in categories if not c.startswith("-")],
                                                                   "excludedCategories": [c[1:] for c in categories if c.startswith("-") and c != "-*"]},
                                                   "transferMode": "ReportEvents"})
            except Gated as error:
                raise error.during(f"{kind} start") from None

        await activate(ctx, page, "trace", enable)
        ctx.state.listeners.append(listener)
        record["listener"] = listener
        ctx.state.extras["tracing"] = record
        ctx.state.leases.add("trace")
        return Result({"started": True}, "✓ Profiling started" if kind == "profiler" else "✓ Recording started")
    if args[0] != "stop":
        raise Usage(f"Usage: ardia browse {kind} start|stop [path]")
    record = ctx.state.extras.pop("tracing", None)
    if not record:
        raise BrowseError(f"No {kind} is recording")
    try:
        await page.send("Tracing.end")
        await asyncio.wait_for(record["done"], 60)
    finally:
        ctx.state.listeners.remove(record["listener"])
        ctx.state.leases.discard("trace")
        release_claim(ctx, record["target"], "trace")
    path = ctx.path(args[1]) if len(args) > 1 else os.path.join(os.path.dirname(default_dir(ctx)), f"trace-{int(time.time())}.json")
    Path(path).write_text(json.dumps({"traceEvents": record["events"]}), encoding="utf-8")
    shown = args[1] if len(args) > 1 else path
    count = len(record["events"])
    if kind == "profiler":
        return Result({"path": shown, "events": count}, f"✓ Profile saved to {shown} ({count} events)")
    return Result({"path": shown, "events": count}, f"✓ Trace saved to {shown}")


@command("trace")
async def cmd_trace(ctx, argv):
    return await tracing(ctx, argv, "trace")


@command("profiler")
async def cmd_profiler(ctx, argv):
    return await tracing(ctx, argv, "profiler")


class Screencast:
    def __init__(self, page, quality=80, max_width=None, max_height=None):
        self.page = page
        self.quality = quality
        self.max_width = max_width
        self.max_height = max_height
        self.latest = None
        self.seq = 0
        self.waiters: list[asyncio.Event] = []
        self.listener = None

    async def start(self, state):
        def listener(event_page, method, params):
            if event_page is self.page and method == "Page.screencastFrame":
                self.seq += 1
                self.latest = (self.seq, params.get("data"), params.get("metadata") or {})
                for waiter in self.waiters:
                    waiter.set()
                asyncio.ensure_future(self._ack(params.get("sessionId")))

        params = {"format": "jpeg", "quality": self.quality, "everyNthFrame": 1}
        if self.max_width:
            params["maxWidth"] = self.max_width
        if self.max_height:
            params["maxHeight"] = self.max_height
        await self.page.send("Page.startScreencast", params)
        state.listeners.append(listener)
        self.listener = listener

    async def _ack(self, session_id):
        try:
            await self.page.send("Page.screencastFrameAck", {"sessionId": session_id})
        except BrowseError:
            pass

    async def stop(self, state):
        if self.listener in state.listeners:
            state.listeners.remove(self.listener)
        try:
            await self.page.send("Page.stopScreencast")
        except BrowseError:
            pass


@command("record")
async def cmd_record(ctx, argv):
    _, args = parse(argv)
    need(args, 1, "record start <path.webm> [url] | stop | restart <path.webm> [url]")
    action = args[0]
    if action in ("stop", "restart"):
        stopped = await stop_recording(ctx)
        if action == "stop":
            if not stopped:
                raise BrowseError("No recording is running")
            return Result({"path": stopped}, f"✓ Recording saved to {stopped}")
    if action not in ("start", "restart"):
        raise Usage(f"Unknown record action: {action}")
    need(args, 2, f"record {action} <path.webm> [url]")
    if ctx.state.extras.get("recording"):
        raise BrowseError("A recording is already running; stop it first")
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise BrowseError("record needs ffmpeg on PATH to encode WebM (brew install ffmpeg)")
    if len(args) > 2:
        from ardia_cli.browse.commands import current_or_new, navigate

        page = await current_or_new(ctx)
        await navigate(ctx, page, normalize_url(args[2]))
    else:
        page = await ctx.state.page()
    await page.require_visible()
    cast = Screencast(page)

    async def enable():
        try:
            await cast.start(ctx.state)
        except Gated as error:
            raise error.during("record start") from None

    await activate(ctx, page, "record", enable)
    path = ctx.path(args[1])
    try:
        process = await spawn_encoder(ffmpeg, path)
    except BaseException:
        await cast.stop(ctx.state)
        release_claim(ctx, page.target_id, "record")
        raise
    recording = {"cast": cast, "process": process, "path": args[1]}
    return await start_pump(ctx, recording)


async def spawn_encoder(ffmpeg, path):
    return await asyncio.create_subprocess_exec(
        ffmpeg, "-loglevel", "error", "-y", "-f", "image2pipe", "-framerate", "25", "-c:v", "mjpeg", "-i", "-",
        "-c:v", "libvpx-vp9", "-b:v", "1500k", "-deadline", "realtime", "-cpu-used", "8", "-pix_fmt", "yuv420p", path,
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
    )


async def start_pump(ctx, recording):
    cast, process = recording["cast"], recording["process"]

    async def pump():
        try:
            while True:
                await asyncio.sleep(1 / 25)
                if cast.latest is not None:
                    process.stdin.write(base64.b64decode(cast.latest[1]))
                    await process.stdin.drain()
        except (asyncio.CancelledError, BrokenPipeError, ConnectionResetError):
            pass

    recording["pump"] = asyncio.ensure_future(pump())
    ctx.state.extras["recording"] = recording
    ctx.state.leases.add("record")
    return Result({"path": recording["path"], "started": True}, f"✓ Recording started ({recording['path']})")


async def stop_recording(ctx):
    recording = ctx.state.extras.pop("recording", None)
    if not recording:
        return None
    ctx.state.leases.discard("record")
    release_claim(ctx, recording["cast"].page.target_id, "record")
    recording["pump"].cancel()
    await asyncio.gather(recording["pump"], return_exceptions=True)
    await recording["cast"].stop(ctx.state)
    process = recording["process"]
    try:
        process.stdin.close()
        await asyncio.wait_for(process.wait(), 60)
    except asyncio.TimeoutError:
        process.kill()
        raise BrowseError("ffmpeg didn't finish the WebM in 60 s")
    if process.returncode:
        detail = (await process.stderr.read()).decode(errors="replace")[-400:]
        raise BrowseError(f"ffmpeg failed: {detail.strip()}")
    return recording["path"]


@command("stream")
async def cmd_stream(ctx, argv):
    options, args = parse(argv, {"--port": "value", "--input": "bool"})
    action = args[0] if args else "status"
    stream = ctx.state.extras.get("stream")
    if action == "status":
        if not stream:
            return Result({"enabled": False, "connected": False, "screencasting": False}, "Streaming disabled")
        data = {"enabled": True, "port": stream["port"], "url": stream["url"], "connected": bool(stream["clients"]),
                "clients": len(stream["clients"]), "screencasting": True, "input": stream["input"], "frames": stream["cast"].seq}
        return Result(data, f"Streaming enabled on {stream['url']}\nConnected: {str(bool(stream['clients'])).lower()}\nScreencasting: true\nInput: {'on' if stream['input'] else 'off (view only)'}")
    if action == "disable":
        if stream:
            await stop_stream(ctx)
        return Result({"enabled": False}, "✓ Streaming disabled")
    if action != "enable":
        raise Usage("Usage: ardia browse stream enable [--port N] [--input] | disable | status")
    if stream:
        raise BrowseError(f"Streaming is already on at {stream['url']}")
    page = await ctx.state.page()
    await page.require_visible()
    quality = int(ctx.env.get("AGENT_BROWSER_STREAM_QUALITY") or 80)
    cast = Screencast(page, max(0, min(100, quality)), int(ctx.env.get("AGENT_BROWSER_STREAM_MAX_WIDTH") or 0) or None,
                      int(ctx.env.get("AGENT_BROWSER_STREAM_MAX_HEIGHT") or 0) or None)
    async def enable():
        try:
            await cast.start(ctx.state)
        except Gated as error:
            raise error.during("stream enable") from None

    await activate(ctx, page, "stream", enable)
    port = int(options.get("port") or ctx.env.get("AGENT_BROWSER_STREAM_PORT") or 0)
    token = secrets.token_urlsafe(24)
    stream = {"cast": cast, "clients": set(), "input": bool(options.get("input")), "token": token, "page": page}
    try:
        server = await start_stream_server(ctx, stream, port)
    except BaseException:
        await cast.stop(ctx.state)
        release_claim(ctx, page.target_id, "stream")
        raise
    stream["server"] = server
    stream["port"] = server.sockets[0].getsockname()[1]
    stream["url"] = f"ws://127.0.0.1:{stream['port']}/?token={token}"
    ctx.state.extras["stream"] = stream
    ctx.state.leases.add("stream")
    return Result({"enabled": True, "port": stream["port"], "url": stream["url"], "input": stream["input"]},
                  f"✓ Streaming on {stream['url']} ({'input enabled' if stream['input'] else 'view only'})")


async def start_stream_server(ctx, stream, port):
    from websockets.asyncio.server import serve
    from websockets.http11 import Response
    from websockets.datastructures import Headers

    def refuse(status, text):
        return Response(status, text, Headers([("Content-Type", "text/plain")]), text.encode())

    def process_request(connection, request):
        from urllib.parse import parse_qs, urlsplit

        bound = connection.local_address[1]
        host = request.headers.get("Host", "")
        if host not in (f"127.0.0.1:{bound}", f"localhost:{bound}"):
            return refuse(403, "Forbidden host")
        origin = request.headers.get("Origin")
        if origin is not None and origin not in (f"http://127.0.0.1:{bound}", f"http://localhost:{bound}"):
            return refuse(403, "Forbidden origin")
        query = parse_qs(urlsplit(request.path).query)
        if not secrets.compare_digest((query.get("token") or [""])[0], stream["token"]):
            return refuse(401, "Missing or wrong token")
        if len(stream["clients"]) >= STREAM_CLIENTS:
            return refuse(503, "Too many clients")
        return None

    async def handler(connection):
        stream["clients"].add(connection)
        waiter = asyncio.Event()
        stream["cast"].waiters.append(waiter)
        if stream["cast"].latest is not None:
            waiter.set()
        sent = 0
        try:
            await connection.send(json.dumps({"type": "status", "connected": True, "screencasting": True, "input": stream["input"]}))

            async def frames():
                nonlocal sent
                while True:
                    await waiter.wait()
                    waiter.clear()
                    latest = stream["cast"].latest
                    if latest and latest[0] != sent:
                        sent = latest[0]
                        await connection.send(json.dumps({"type": "frame", "seq": latest[0], "data": latest[1], "metadata": latest[2]}))

            async def inputs():
                async for raw in connection:
                    try:
                        message = json.loads(raw)
                    except ValueError:
                        continue
                    if not isinstance(message, dict) or not str(message.get("type", "")).startswith("input_"):
                        continue
                    if not stream["input"]:
                        await connection.send(json.dumps({"type": "error", "error": "this stream is view only; restart it with `stream enable --input`"}))
                        continue
                    await stream_input(ctx, stream["page"], message)

            await asyncio.gather(frames(), inputs())
        except Exception:
            logging.getLogger("ardia_cli.browse").debug("stream client ended", exc_info=True)
        finally:
            stream["clients"].discard(connection)
            if waiter in stream["cast"].waiters:
                stream["cast"].waiters.remove(waiter)
            if stream["input"]:
                await release_stream_input(ctx, stream["page"])

    return await serve(handler, "127.0.0.1", port, process_request=process_request, max_size=64 * 1024, compression=None)


async def stream_input(ctx, page, message):
    kind = message.get("type")
    allowed = {
        "input_mouse": ("Input.dispatchMouseEvent", ("type", "x", "y", "button", "clickCount", "deltaX", "deltaY", "modifiers")),
        "input_keyboard": ("Input.dispatchKeyEvent", ("type", "key", "code", "text", "modifiers", "windowsVirtualKeyCode")),
        "input_touch": ("Input.dispatchTouchEvent", ("type", "touchPoints", "modifiers")),
    }
    if kind not in allowed:
        return
    method, keys = allowed[kind]
    params = {key: message[key] for key in keys if key in message}
    if "eventType" in message:
        params["type"] = message["eventType"]
    async with ctx.state.extras["command_lock"]:
        page.input.track_stream_event(method, params)
        try:
            await page.send(method, params, input_event=True)
        except BrowseError:
            await page.input.release_all()


async def release_stream_input(ctx, page):
    if page is None or not page.input.holding:
        return
    async with ctx.state.extras["command_lock"]:
        await page.input.release_all()


async def stop_stream(ctx):
    stream = ctx.state.extras.pop("stream", None)
    if not stream:
        return
    ctx.state.leases.discard("stream")
    release_claim(ctx, stream["page"].target_id, "stream")
    stream["server"].close()
    for client in list(stream["clients"]):
        await client.close()
    await stream["cast"].stop(ctx.state)
