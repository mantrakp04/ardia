import asyncio
import datetime as dt
import time

from ardia_cli.hooks import DAYS

CHECK_INTERVAL = 20.0
ON_TIME = 90.0


def zone_of(name: str | None):
    if not name:
        return None
    from zoneinfo import ZoneInfo

    return ZoneInfo(name)


def next_at(hook, after: float) -> float:
    zone = zone_of(hook.timezone)
    hour, minute = int(hook.at[:2]), int(hook.at[3:])
    start = dt.datetime.fromtimestamp(after, zone).replace(second=0, microsecond=0)
    for offset in range(0, 8):
        day = (start + dt.timedelta(days=offset)).replace(hour=hour, minute=minute)
        if zone is None:
            day = day.replace(tzinfo=None)
        stamp = day.timestamp()
        if stamp <= after:
            continue
        if hook.days and DAYS[day.weekday()] not in hook.days:
            continue
        return stamp
    raise ValueError(f"hook {hook.name}: no time matches at {hook.at}")


def occurrence(hook, stamp: float) -> str:
    zone = zone_of(hook.timezone)
    return f"{hook.name}@{dt.datetime.fromtimestamp(stamp, zone).strftime('%Y-%m-%dT%H:%M')}"


class Scheduler:
    def __init__(self, fire, log, wall=time.time, mono=time.monotonic):
        self.fire = fire
        self.log = log
        self.wall = wall
        self.mono = mono
        self.state: dict[str, dict] = {}
        self.hooks: dict[str, object] = {}

    def set_hooks(self, hooks) -> None:
        wanted = {h.name: h for h in hooks if h.scheduled}
        for name in list(self.state):
            if self.hooks.get(name) != wanted.get(name):
                del self.state[name]
        self.hooks = wanted
        for name, hook in wanted.items():
            if name in self.state:
                continue
            if hook.at is not None:
                self.state[name] = {"due": next_at(hook, self.wall())}
            else:
                self.state[name] = {"due_mono": self.mono() + hook.every, "last_wall": self.wall()}

    def check(self) -> list[dict]:
        fired = []
        now, mono = self.wall(), self.mono()
        for name, hook in self.hooks.items():
            state = self.state[name]
            if hook.at is not None:
                if now < state["due"]:
                    continue
                late = now - state["due"]
                fired.append(self._event(hook, state["due"], "at", late > ON_TIME))
                state["due"] = next_at(hook, now)
                continue
            slept = now - state["last_wall"] >= hook.every + ON_TIME and mono < state["due_mono"]
            if mono >= state["due_mono"] or slept:
                scheduled = state["last_wall"] + hook.every
                fired.append(self._event(hook, scheduled, "every", slept or now - scheduled > ON_TIME))
                state["due_mono"] = mono + hook.every
                state["last_wall"] = now
        for event in fired:
            self.fire(self.hooks[event["data"]["hook"]], event)
        return fired

    def _event(self, hook, scheduled: float, kind: str, catch_up: bool) -> dict:
        data = {"hook": hook.name, "schedule": kind, "occurrence": occurrence(hook, scheduled), "scheduledAt": int(scheduled * 1000), "catchUp": catch_up}
        if hook.at is not None:
            data["timezone"] = hook.timezone or time.strftime("%Z")
        return {"event": "schedule.fired", "time": int(self.wall() * 1000), "data": data}

    def wait_time(self) -> float:
        waits = [CHECK_INTERVAL]
        now, mono = self.wall(), self.mono()
        for name, hook in self.hooks.items():
            state = self.state[name]
            waits.append(state["due"] - now if hook.at is not None else state["due_mono"] - mono)
        return max(min(waits), 0.05)

    async def run(self) -> None:
        while True:
            try:
                self.check()
            except Exception as error:
                self.log.write(f"schedules: {type(error).__name__}: {error}")
            await asyncio.sleep(self.wait_time())
