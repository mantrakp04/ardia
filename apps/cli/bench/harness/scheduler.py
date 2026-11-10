from dataclasses import dataclass, field

GROW_BELOW = 70.0
HOLD_AT = 75.0
BLOCK_ABOVE = 80.0
RESUME_BELOW = 75.0
SETTLE_S = 20.0
RETRY_AFTER_S = 120.0
IDLE_QUIT_S = 120.0
MAX_TASK_CONCURRENCY = 8


@dataclass
class Lane:
    id: str
    group: str
    kind: str
    index: int
    busy: bool = False
    launched: bool = False
    idle_since: float = 0.0


@dataclass
class Scheduler:
    items: list
    max_lanes: int = 6
    lead: int = 1
    settle_s: float = SETTLE_S
    pace_slack: float = 0.15
    pending: list = field(default_factory=list)
    running: dict = field(default_factory=dict)
    lanes: list = field(default_factory=list)
    caps: dict = field(default_factory=dict)
    not_before: dict = field(default_factory=dict)
    retries: dict = field(default_factory=dict)
    credits: int = 0
    holding: bool = False
    blocked: bool = False
    last_growth: float = float("-inf")
    growth_in_flight: int = 0

    def __post_init__(self):
        self.order = {it["run_id"]: n for n, it in enumerate(self.items)}
        self.pending = list(self.items)
        self.total = {}
        for it in self.items:
            self.total[it["contender"]["id"]] = self.total.get(it["contender"]["id"], 0) + 1
        self.started_count = {c: 0 for c in self.total}

    @staticmethod
    def group_of(item):
        c = item["contender"]
        return "aside" if c["kind"] == "aside" else c["id"]

    def cap(self, group):
        return 1 if group == "aside" else self.caps.get(group, self.max_lanes)

    def tasks_in_use(self):
        return {it["task"] for it, _ in self.running.values()}

    def min_round(self):
        rounds = [it["round"] for it in self.pending] + [it["round"] for it, _ in self.running.values()]
        return min(rounds) if rounds else 0

    def pace(self, contender_id):
        return self.started_count[contender_id] / self.total[contender_id]

    def pace_ok(self, item):
        waiting = {it["contender"]["id"] for it in self.pending}
        floor = min(self.pace(c) for c in waiting)
        return self.pace(item["contender"]["id"]) <= floor + self.pace_slack

    def update_flags(self, used):
        if used >= HOLD_AT:
            self.holding = True
        elif used < GROW_BELOW:
            self.holding = False
        if used > BLOCK_ABOVE:
            self.blocked = True
        elif used < RESUME_BELOW:
            self.blocked = False

    def lane_for(self, group):
        idle = [ln for ln in self.lanes if ln.group == group and not ln.busy]
        idle.sort(key=lambda ln: (not ln.launched, ln.index))
        if idle:
            return idle[0], idle[0].launched
        mine = [ln for ln in self.lanes if ln.group == group]
        if len(mine) >= self.cap(group) or len(self.lanes) >= self.max_lanes:
            return None, False
        if group == "aside":
            return Lane(id="aside", group=group, kind="aside", index=0), False
        used = {ln.index for ln in self.lanes if ln.kind == "ardia"}
        index = next(i for i in range(len(used) + 1) if i not in used)
        return Lane(id=f"{group}@{index}", group=group, kind="ardia", index=index), False

    def growth_ok(self, now, used):
        return (used < GROW_BELOW and not self.holding and self.growth_in_flight == 0
                and now - self.last_growth >= self.settle_s)

    def decide(self, now, used):
        self.update_flags(used)
        starts = []
        grown = False
        while len(self.running) < min(self.max_lanes, MAX_TASK_CONCURRENCY):
            busy_tasks = self.tasks_in_use()
            limit = self.min_round() + self.lead
            chosen = None
            for it in self.pending:
                if it["task"] in busy_tasks or it["round"] > limit or self.not_before.get(it["run_id"], 0) > now:
                    continue
                if not self.pace_ok(it):
                    continue
                lane, warm = self.lane_for(self.group_of(it))
                if lane is None:
                    continue
                if warm and self.credits > 0 and not self.blocked:
                    chosen = (it, lane, "reuse")
                    break
                if not grown and self.growth_ok(now, used):
                    chosen = (it, lane, "grow")
                    break
            if not chosen:
                break
            it, lane, mode = chosen
            if mode == "reuse":
                self.credits -= 1
            else:
                grown = True
                self.last_growth = now
                self.growth_in_flight += 1
            if lane not in self.lanes:
                self.lanes.append(lane)
            lane.busy = True
            self.started_count[it["contender"]["id"]] += 1
            self.pending.remove(it)
            self.running[it["run_id"]] = (it, lane)
            starts.append((it, lane, mode))
        return starts

    def started(self, now, mode):
        if mode == "grow":
            self.growth_in_flight = max(0, self.growth_in_flight - 1)
            self.last_growth = now

    def finish(self, run_id, now, outcome="done", rate_limited=False):
        it, lane = self.running.pop(run_id)
        lane.busy = False
        lane.launched = True
        lane.idle_since = now
        self.credits = min(self.credits + 1, self.warm_idle())
        group = self.group_of(it)
        if rate_limited:
            self.caps[group] = 1
        if outcome == "retry" and self.retries.get(run_id, 0) < 3:
            self.retries[run_id] = self.retries.get(run_id, 0) + 1
            self.not_before[run_id] = now + RETRY_AFTER_S
            self.started_count[it["contender"]["id"]] -= 1
            self.pending.append(it)
            self.pending.sort(key=lambda x: self.order[x["run_id"]])
        return it, lane

    def warm_idle(self):
        return sum(1 for ln in self.lanes if ln.launched and not ln.busy)

    def idle_lanes_to_quit(self, now):
        groups_pending = {self.group_of(it) for it in self.pending}
        out = []
        for ln in self.lanes:
            if ln.kind != "ardia" or ln.busy:
                continue
            mine = sorted((x for x in self.lanes if x.group == ln.group), key=lambda x: x.index)
            extra = mine.index(ln) >= 1
            surplus = (extra and (self.holding or now - ln.idle_since >= IDLE_QUIT_S)) or mine.index(ln) >= self.cap(ln.group)
            if ln.group not in groups_pending or surplus:
                out.append(ln)
        return out

    def drop_lane(self, lane):
        self.lanes.remove(lane)
        self.credits = min(self.credits, self.warm_idle())

    def done(self):
        return not self.pending and not self.running
