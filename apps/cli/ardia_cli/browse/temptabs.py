import asyncio

from ardia_cli.browse.errors import BrowseError

CLOSE_TIMEOUT = 3.0
GONE_WAIT = 2.0
GONE_POLL = 0.05


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
        owned.append(result["targetId"])
        state.registry.note_temporary(state.instance, result["targetId"])
        return result["targetId"]

    return await settle_then_cancel(asyncio.ensure_future(make()))


async def present_targets(state) -> set[str] | None:
    if not state.connected:
        return None
    try:
        infos = (await asyncio.wait_for(state.browser.send("Target.getTargets"), CLOSE_TIMEOUT)).get("targetInfos") or []
    except Exception:
        return None
    return {info.get("targetId") for info in infos}


async def gone(state, target_id: str) -> bool:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + GONE_WAIT
    while True:
        present = await present_targets(state)
        if present is not None and target_id not in present:
            return True
        if present is None or loop.time() >= deadline:
            return False
        await asyncio.sleep(GONE_POLL)


async def close_one(state, target_id: str):
    registry = state.registry
    if registry.reserve_close(state.instance, target_id):
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
    orphans = state.registry.claim_orphans(state.instance)
    present = await present_targets(state) if orphans else None
    if present is None:
        return
    for target_id in orphans:
        if target_id not in present:
            state.registry.drop_temporary(state.instance, target_id)
    await release(state, [target_id for target_id in orphans if target_id in present])
