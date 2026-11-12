import asyncio

from ardia_cli.browse.errors import BrowseError

CLOSE_TIMEOUT = 3.0
GONE_WAIT = 2.0
GONE_POLL = 0.05
RETRY_FIRST = 1.0
RETRY_MAX = 30.0
DRAIN_BUDGET = 3.0


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

    registry = state.registry
    slot = registry.reserve_temporary(state.instance)

    async def make():
        try:
            result = await state.browser.send("Target.createTarget", {"url": "about:blank", "background": True})
        except BaseException as error:
            give_back(state, slot)
            if isinstance(error, Gated):
                raise BrowseError(f"Ardia's policy refused to open a tab for the ardia command ({error.refusal})") from None
            raise
        target_id = result["targetId"]
        try:
            registry.note_temporary(state.instance, target_id, slot)
        except BaseException:
            must_close(state, target_id)
            give_back(state, slot)
            raise
        owned.append(target_id)
        return target_id

    return await settle_then_cancel(asyncio.ensure_future(make()))


def give_back(state, slot: str | None):
    if slot is None:
        return
    try:
        state.registry.drop_temporary(state.instance, slot)
    except Exception:
        pass


def must_close(state, target_id: str):
    state.extras.setdefault("must_close", set()).add(target_id)
    task = state.extras.get("must_close_task")
    if task is None or task.done():
        state.extras["must_close_task"] = asyncio.ensure_future(retry_closes(state))


async def close_untracked(state, target_id: str) -> bool:
    if not state.connected:
        return False
    try:
        await asyncio.wait_for(state.browser.send("Target.closeTarget", {"targetId": target_id}), CLOSE_TIMEOUT)
    except Exception:
        return False
    return await gone(state, target_id)


async def retry_closes(state):
    pending = state.extras["must_close"]
    delay = RETRY_FIRST
    while pending:
        for target_id in list(pending):
            if await close_untracked(state, target_id):
                pending.discard(target_id)
                state.forget_target(target_id)
        if pending:
            await asyncio.sleep(delay)
            delay = min(delay * 2, RETRY_MAX)


async def drain(state):
    pending = state.extras.get("must_close")
    if not pending:
        return
    task = state.extras.pop("must_close_task", None)
    if task is not None and not task.done():
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    async def close_each():
        for target_id in list(pending):
            if await close_untracked(state, target_id):
                pending.discard(target_id)

    try:
        await asyncio.wait_for(close_each(), DRAIN_BUDGET)
    except asyncio.TimeoutError:
        pass
    for target_id in list(pending):
        try:
            state.registry.note_temporary(state.instance, target_id)
        except Exception:
            continue
        pending.discard(target_id)


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
