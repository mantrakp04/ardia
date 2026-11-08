import asyncio

from ardia_cli.browse.errors import BrowseError

CLOSE_TIMEOUT = 3.0


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

    async def make():
        try:
            result = await state.browser.send("Target.createTarget", {"url": "about:blank", "background": True})
        except Gated:
            raise BrowseError("Ardia's policy refused to open a tab for the ardia command") from None
        target_id = result["targetId"]
        owned.append(target_id)
        live(state).add(target_id)
        state.registry.note_temporary(state.instance, target_id)
        return target_id

    return await settle_then_cancel(asyncio.ensure_future(make()))


async def close_one(state, target_id: str):
    registry = state.registry
    live(state).discard(target_id)
    if not registry.reserve_close(state.instance, target_id):
        registry.drop_temporary(state.instance, target_id)
        state.forget_target(target_id)
        return
    try:
        if state.connected:
            await asyncio.wait_for(state.browser.send("Target.closeTarget", {"targetId": target_id}), CLOSE_TIMEOUT)
    except Exception:
        pass
    finally:
        registry.finish_close(state.instance, target_id)
    state.forget_target(target_id)


async def close_all(state, owned: list[str]):
    for target_id in list(owned):
        await close_one(state, target_id)
        owned.remove(target_id)


async def release(state, owned: list[str]):
    await settle_then_cancel(asyncio.ensure_future(close_all(state, owned)))


async def sweep(state):
    left = [target for target in state.registry.temporaries(state.instance) if target not in live(state)]
    if not left:
        return
    owned = [target for target in left if target in state.target_infos]
    for target in left:
        if target not in owned:
            state.registry.drop_temporary(state.instance, target)
    await release(state, owned)
