import asyncio
import secrets

from ardia_cli.browse.errors import BrowseError

CLOSE_TIMEOUT = 3.0
GONE_WAIT = 2.0
GONE_POLL = 0.05
MARKER = "ardia-temp-"


def live(state) -> set[str]:
    return state.extras.setdefault("temporaries", set())


async def settle_then_cancel(task):
    cancelled = False
    while not task.done():
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            cancelled = True
    if cancelled:
        raise asyncio.CancelledError
    return task.result()


async def create(state, owned: list[str]) -> str:
    from ardia_cli.browse.errors import Gated

    marker = MARKER + secrets.token_hex(8)
    registry = state.registry

    async def make():
        registry.note_intent(state.instance, marker)
        try:
            result = await state.browser.send("Target.createTarget", {"url": f"about:blank#{marker}", "background": True})
        except Gated:
            registry.drop_intent(state.instance, marker)
            raise BrowseError("Ardia's policy refused to open a tab for the ardia command") from None
        except BrowseError as error:
            if error.code not in ("outcome_unknown", "connection_lost"):
                registry.drop_intent(state.instance, marker)
            raise
        target_id = result["targetId"]
        owned.append(target_id)
        live(state).add(target_id)
        registry.note_temporary(state.instance, target_id)
        registry.drop_intent(state.instance, marker)
        return target_id

    return await settle_then_cancel(asyncio.ensure_future(make()))


async def gone(state, target_id: str) -> bool:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + GONE_WAIT
    while True:
        try:
            infos = (await asyncio.wait_for(state.browser.send("Target.getTargets"), CLOSE_TIMEOUT)).get("targetInfos") or []
        except Exception:
            return False
        if all(info.get("targetId") != target_id for info in infos):
            return True
        if loop.time() >= deadline:
            return False
        await asyncio.sleep(GONE_POLL)


async def close_one(state, target_id: str):
    registry = state.registry
    live(state).discard(target_id)
    if not registry.reserve_close(state.instance, target_id):
        state.forget_target(target_id)
        return
    closed = False
    try:
        if state.connected:
            await asyncio.wait_for(state.browser.send("Target.closeTarget", {"targetId": target_id}), CLOSE_TIMEOUT)
            closed = await gone(state, target_id)
    except Exception:
        closed = False
    finally:
        if closed:
            registry.finish_close(state.instance, target_id)
        else:
            registry.release_close(state.instance, target_id)
    state.forget_target(target_id)


async def close_all(state, owned: list[str]):
    for target_id in list(owned):
        await close_one(state, target_id)
        owned.remove(target_id)


async def release(state, owned: list[str]):
    await settle_then_cancel(asyncio.ensure_future(close_all(state, owned)))


async def sweep(state):
    registry = state.registry
    for marker in registry.claim_orphans(state.instance):
        for target_id, info in list(state.target_infos.items()):
            if str(info.get("url") or "").endswith("#" + marker):
                registry.note_temporary(state.instance, target_id)
        registry.drop_intent(state.instance, marker)
    left = [target for target in registry.temporaries(state.instance) if target not in live(state)]
    if not left:
        return
    owned = [target for target in left if target in state.target_infos]
    for target in left:
        if target not in owned:
            registry.drop_temporary(state.instance, target)
    await release(state, owned)
