import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scheduler
from scheduler import Scheduler

TASKS = ["calendar", "expenses", "research", "booking", "shop", "grid", "kanban", "multitab"]
CONTENDERS = [{"id": "ardia-claude", "kind": "ardia"}, {"id": "ardia-codex", "kind": "ardia"},
              {"id": "aside-opus", "kind": "aside"}, {"id": "aside-sol", "kind": "aside"}]


def plan_items(repeats=3):
    out = []
    for r in range(repeats):
        tasks = TASKS[r:] + TASKS[:r]
        contenders = CONTENDERS[r % 4:] + CONTENDERS[:r % 4]
        for t in tasks:
            for c in contenders:
                out.append({"round": r + 1, "task": t, "contender": c, "run_id": f"{t}--{c['id']}--r{r + 1}"})
    return out


def simulate(seed, max_lanes=6, memory=None, retry_ids=(), rate_limit_ids=()):
    rng = random.Random(seed)
    items = plan_items()
    s = Scheduler(items, max_lanes=max_lanes)
    t, finishing, launching, log = 0.0, {}, {}, []
    retry_left = set(retry_ids) | set(rate_limit_ids)
    while not s.done() and t < 10 ** 6:
        for rid in [r for r, at in launching.items() if at <= t]:
            s.started(t, "grow")
            del launching[rid]
        for rid in [r for r, at in finishing.items() if at <= t]:
            del finishing[rid]
            if rid in retry_left:
                retry_left.discard(rid)
                s.finish(rid, t, "retry", rate_limited=rid in rate_limit_ids)
                log.append(("retry", t, rid))
            else:
                s.finish(rid, t)
                log.append(("done", t, rid))
        for lane in s.idle_lanes_to_quit(t):
            s.drop_lane(lane)
        used = memory(t, len(s.running)) if memory else 50.0
        for item, lane, mode in s.decide(t, used):
            log.append(("start", t, item["run_id"], item["task"], lane.id, lane.group, mode, used,
                        len(s.running), s.holding, s.blocked))
            if mode == "grow":
                launching[item["run_id"]] = t + 15
            finishing[item["run_id"]] = t + rng.uniform(30, 400)
        t += 2.0
    return s, items, log


def overlapping(log):
    running, worst = {}, []
    for e in sorted(log, key=lambda e: (e[1], 0 if e[0] != "start" else 1)):
        if e[0] == "start":
            running[e[2]] = e
            worst.append(list(running.values()))
        else:
            running.pop(e[2], None)
    return worst


class SchedulerTest(unittest.TestCase):
    def test_every_run_starts_once_and_finishes(self):
        for seed in range(20):
            s, items, log = simulate(seed)
            starts = [e[2] for e in log if e[0] == "start"]
            self.assertEqual(sorted(starts), sorted(it["run_id"] for it in items))
            self.assertTrue(s.done())

    def test_no_two_runs_share_a_task_and_lanes_stay_capped(self):
        for seed in range(20):
            _, _, log = simulate(seed, max_lanes=6)
            for running in overlapping(log):
                tasks = [e[3] for e in running]
                self.assertEqual(len(tasks), len(set(tasks)))
                self.assertLessEqual(len(running), 6)
                self.assertLessEqual(sum(1 for e in running if e[5] == "aside"), 1)
                lanes = [e[4] for e in running]
                self.assertEqual(len(lanes), len(set(lanes)))

    def test_each_cell_keeps_its_round_order(self):
        for seed in range(10):
            _, _, log = simulate(seed)
            seen = {}
            for e in (e for e in log if e[0] == "start"):
                task, contender, r = e[2].split("--")
                cell = (task, contender)
                self.assertLess(seen.get(cell, 0), int(r[1:]))
                seen[cell] = int(r[1:])

    def test_growth_only_under_the_memory_gate(self):
        def memory(t, running):
            return 60.0 + 4.0 * running + (12.0 if 2000 < t < 3000 else 0.0)

        for seed in range(10):
            s, items, log = simulate(seed, memory=memory)
            self.assertTrue(s.done())
            for e in (e for e in log if e[0] == "start"):
                if e[6] == "grow":
                    self.assertLess(e[7], scheduler.GROW_BELOW)
                if e[7] > scheduler.BLOCK_ABOVE:
                    self.fail(f"started {e[2]} at {e[7]}% used")

    def test_growth_is_spaced_by_the_settle_gap(self):
        _, _, log = simulate(3)
        grows = [e[1] for e in log if e[0] == "start" and e[6] == "grow"]
        for a, b in zip(grows, grows[1:]):
            self.assertGreaterEqual(b - a, scheduler.SETTLE_S)

    def test_retried_runs_run_again_and_rate_limits_drop_to_one_lane(self):
        limited = "grid--ardia-codex--r1"
        s, items, log = simulate(5, retry_ids=["shop--ardia-claude--r1"], rate_limit_ids=[limited])
        starts = [e[2] for e in log if e[0] == "start"]
        self.assertEqual(starts.count("shop--ardia-claude--r1"), 2)
        self.assertEqual(starts.count(limited), 2)
        self.assertEqual(s.cap("ardia-codex"), 1)
        retried_at = next(e[1] for e in log if e[0] == "retry" and e[2] == limited)
        for running in overlapping([e for e in log if e[1] > retried_at]):
            self.assertLessEqual(sum(1 for e in running if e[5] == "ardia-codex"), 1)

    def test_contenders_progress_together(self):
        _, items, log = simulate(7)
        total = {c["id"]: sum(1 for it in items if it["contender"]["id"] == c["id"]) for c in CONTENDERS}
        count = {c: 0 for c in total}
        for e in (e for e in log if e[0] == "start"):
            c = e[2].split("--")[1]
            count[c] += 1
            paces = [count[x] / total[x] for x in total if count[x] < total[x] or x == c]
            self.assertLessEqual(count[c] / total[c] - min(paces), 0.15 + 1 / total[c] + 1e-9)


if __name__ == "__main__":
    unittest.main()
