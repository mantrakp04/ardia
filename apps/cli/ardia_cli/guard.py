import json

from ardia_cli import identity

FORBIDDEN_METHODS = frozenset({"Browser.close", "Browser.crash", "Browser.crashGpuProcess"})


class ForbiddenCommand(RuntimeError):
    __module__ = "__main__"


def check_method(method) -> None:
    name = getattr(method, "value", method)
    if name in FORBIDDEN_METHODS:
        raise ForbiddenCommand(f"{identity.COMMAND} exec never sends {name}: it's the user's browser")


def check_command(command) -> None:
    if isinstance(command, dict):
        check_method(command.get("method"))


def check_message(message) -> None:
    if isinstance(message, (bytes, bytearray, memoryview)):
        message = bytes(message).decode("utf-8", "replace")
    if not isinstance(message, str):
        return
    try:
        payload = json.loads(message)
    except ValueError:
        raise ForbiddenCommand(f"{identity.COMMAND} exec only sends JSON commands") from None
    for command in payload if isinstance(payload, list) else [payload]:
        check_command(command)


async def direct_connect(uri, **kwargs):
    import websockets

    kwargs["proxy"] = None
    connection = await websockets.connect(uri, **kwargs)
    send = connection.send

    async def guarded_send(message, *args, **send_kwargs):
        if not isinstance(message, (str, bytes, bytearray, memoryview)):
            raise ForbiddenCommand(f"{identity.COMMAND} exec only sends whole messages, not fragments")
        check_message(message)
        return await send(message, *args, **send_kwargs)

    connection.send = guarded_send
    return connection


def install() -> None:
    from pydoll.connection.connection_handler import ConnectionHandler

    if getattr(ConnectionHandler, "_ardia_guarded", False):
        return
    init = ConnectionHandler.__init__

    def direct_init(self, *args, **kwargs):
        kwargs["ws_connector"] = direct_connect
        init(self, *args, **kwargs)

    def guard_one(method):
        async def guarded(self, command, *args, **kwargs):
            check_command(command)
            return await method(self, command, *args, **kwargs)

        return guarded

    execute_commands = ConnectionHandler.execute_commands

    async def guarded_batch(self, commands, *args, **kwargs):
        commands = list(commands)
        for command in commands:
            check_command(command)
        return await execute_commands(self, commands, *args, **kwargs)

    ConnectionHandler.__init__ = direct_init
    ConnectionHandler.execute_command = guard_one(ConnectionHandler.execute_command)
    ConnectionHandler.execute_command_nowait = guard_one(ConnectionHandler.execute_command_nowait)
    ConnectionHandler.execute_commands = guarded_batch
    ConnectionHandler._ardia_guarded = True
