#!/usr/bin/env python3
import json
import re
import secrets
import sys
import threading
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from benchhttp import Handler, now_ms, serve_forever
from realism import Guard

PORT = 8841
HERE = Path(__file__).resolve().parent
COLUMNS = [("backlog", "Backlog"), ("todo", "To do"), ("progress", "In progress"), ("review", "In review"), ("done", "Done")]
COLUMN_KEYS = [k for k, _ in COLUMNS]
PEOPLE = ["Jordan Lee", "Priya Raman", "Marcus Chen", "Sofia Alvarez", "Dev Patel", "Hannah Okafor"]
LABELS = ["Bug", "Feature", "Design", "Needs design", "iOS", "Android", "Web", "Backend", "Performance",
          "Accessibility", "Tech debt", "Customer-reported", "QA automation", "Needs QA", "Blocked"]
SEED = {
    "backlog": [
        ("SYNC-412", "Spike: evaluate SQLite FTS5 for on-device search", ["Backend", "Performance"], "Dev Patel", ""),
        ("SYNC-398", "Conflict resolution UI for simultaneous edits", ["Feature", "Needs design"], "Sofia Alvarez", "2026-11-24"),
        ("SYNC-420", "Rate-limit sync retries after 429 responses", ["Backend", "Bug"], "", ""),
        ("SYNC-377", "Dark mode for the share sheet", ["Design", "iOS"], "Hannah Okafor", ""),
        ("SYNC-433", "Audit log export for workspace admins", ["Feature", "Customer-reported", "Web"], "", "2026-12-04"),
        ("SYNC-381", "Migrate attachment storage to signed URLs", ["Backend", "Tech debt"], "Marcus Chen", ""),
        ("SYNC-404", "Spike: evaluate SQLite WAL mode for the sync cache", ["Backend", "Performance"], "Dev Patel", ""),
        ("SYNC-441", "Onboarding checklist flickers on Safari", ["Bug", "Web"], "", ""),
        ("SYNC-389", "VoiceOver labels for the sync status pill", ["Accessibility", "iOS"], "Priya Raman", ""),
        ("SYNC-426", "Contract tests for the sync v2 API", ["QA automation", "Backend"], "Marcus Chen", ""),
        ("SYNC-395", "Tablet layout for the activity feed", ["Design", "Android"], "", ""),
        ("SYNC-437", "Remove the legacy v1 sync endpoints", ["Tech debt", "Backend"], "", "2026-12-11"),
        ("SYNC-446", "Settings: remember the last-used export format", ["Feature", "Web"], "Jordan Lee", ""),
    ],
    "todo": [
        ("SYNC-371", "Search ignores accents in contact names", ["Bug", "Customer-reported", "Blocked"], "Jordan Lee", "2026-11-10"),
        ("SYNC-402", "Search ignores accents in file names", ["Bug", "Web"], "Priya Raman", "2026-11-13"),
        ("SYNC-418", "Batch thumbnail generation on upload", ["Performance", "Backend"], "Dev Patel", "2026-11-16"),
        ("SYNC-409", "Empty state for shared folders", ["Design", "Web"], "Hannah Okafor", ""),
        ("SYNC-414", "Keyboard shortcut sheet for the web app", ["Feature", "Web", "Accessibility"], "", "2026-11-18"),
        ("SYNC-423", "Retry banner copy review", ["Design"], "Sofia Alvarez", ""),
    ],
    "progress": [
        ("SYNC-366", "Offline queue for edits made while signed out", ["Feature", "iOS", "Android"], "Jordan Lee", "2026-11-09"),
        ("SYNC-386", "Delta sync for large folders", ["Backend", "Performance"], "Marcus Chen", "2026-11-12"),
        ("SYNC-399", "Sync status pill redesign", ["Design", "iOS"], "Hannah Okafor", "2026-11-11"),
        ("SYNC-411", "Offline banner shows while signed out", ["Bug", "Android"], "Priya Raman", ""),
        ("SYNC-427", "Flaky upload e2e on CI", ["QA automation", "Tech debt"], "Dev Patel", "2026-11-09"),
    ],
    "review": [
        ("SYNC-392", "iOS: duplicate push notifications after reinstall", ["Bug", "iOS"], "Sofia Alvarez", "2026-11-06"),
        ("SYNC-393", "Android: duplicate push notifications after reinstall", ["Bug", "Android", "Customer-reported"], "Priya Raman", "2026-11-06"),
        ("SYNC-405", "Paginate the activity feed API", ["Backend"], "Marcus Chen", "2026-11-10"),
        ("SYNC-416", "Focus order in the share dialog", ["Accessibility", "Web", "Needs QA"], "Hannah Okafor", ""),
    ],
    "done": [
        ("SYNC-351", "Sign-in with passkeys on web", ["Feature", "Web"], "Jordan Lee", "2026-10-30"),
        ("SYNC-355", "Crash when renaming a file offline", ["Bug", "iOS"], "Priya Raman", "2026-10-28"),
        ("SYNC-358", "Cache folder listings for 60 seconds", ["Performance", "Backend"], "Dev Patel", "2026-11-02"),
        ("SYNC-360", "New sync conflict icons", ["Design"], "Hannah Okafor", "2026-11-03"),
        ("SYNC-362", "Upgrade to React Native 0.84", ["Tech debt", "iOS", "Android"], "Marcus Chen", "2026-11-04"),
        ("SYNC-364", "Android: notification channel for sync errors", ["Feature", "Android"], "Sofia Alvarez", "2026-11-05"),
        ("SYNC-368", "Smoke tests for the share flow", ["QA automation"], "Dev Patel", "2026-11-05"),
    ],
}
TRACKED = ("column", "labels", "assignee", "due", "archived", "deleted", "title", "description")
PICKER_MIN, PICKER_MAX = "2026-01-01", "2027-12-31"
LOCK = threading.Lock()
STATE = {}
GUARD = Guard("kanban")


def describe(title, column, assignee):
    return (f"{title}. Part of the Sync 2.0 milestone." if column != "done" else f"{title}. Shipped in the last release.") + \
        (f" {assignee.split()[0]} owns this." if assignee else " Needs an owner.")


def initial_cards():
    cards = {}
    for column, rows in SEED.items():
        for ref, title, labels, assignee, due in rows:
            cards[ref] = {"id": ref, "title": title, "column": column, "labels": [l for l in LABELS if l in labels],
                          "assignee": assignee, "due": due, "archived": False, "deleted": False,
                          "description": describe(title, column, assignee)}
    return cards


def reset():
    with LOCK:
        STATE.update(cards=initial_cards(), order={c: [ref for ref, *_ in SEED.get(c, [])] for c in COLUMN_KEYS},
                     collapsed={"done"}, mutations=0, rejected=0, created=0, passing_since=None, last_change_ms=None,
                     intents={}, unconfirmed_archives=0, off_picker_dues=0, off_set_labels=0, reset_at_ms=now_ms())
    GUARD.reset()


def board_locked():
    visible = [dict(c) for c in STATE["cards"].values() if not c["deleted"]]
    position = {ref: i for col in STATE["order"].values() for i, ref in enumerate(col)}
    for c in visible:
        c["position"] = position.get(c["id"])
    return {"columns": [{"key": k, "name": n, "collapsed": k in STATE["collapsed"], "cards": STATE["order"][k]} for k, n in COLUMNS],
            "cards": sorted(visible, key=lambda c: c["id"]), "people": PEOPLE, "labels": LABELS,
            "me": {"name": "Jordan Lee", "email": "jordan@northwind.dev"}}


def changed_locked():
    STATE["mutations"] += 1
    at = now_ms()
    STATE["last_change_ms"] = at
    passing = grade_locked()["pass"]
    STATE["passing_since"] = (STATE["passing_since"] or at) if passing else None


def detach(ref):
    for col in STATE["order"].values():
        if ref in col:
            col.remove(ref)


def move(ref, column, index):
    card = STATE["cards"][ref]
    detach(ref)
    target = STATE["order"][column]
    index = max(0, min(int(index), len(target)))
    target.insert(index, ref)
    card["column"] = column


def parse_due(raw):
    m = re.fullmatch(r"(\d{4}-\d{2}-\d{2})(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})?)?", raw)
    if not m:
        return None
    try:
        date.fromisoformat(m.group(1))
    except ValueError:
        return None
    return m.group(1)


def from_picker(raw):
    return raw == "" or (re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw) is not None and PICKER_MIN <= raw <= PICKER_MAX)


def issue_intent(ref):
    token = secrets.token_hex(12)
    STATE["intents"][token] = ref
    return token


def confirmed_archive(ref, token):
    if isinstance(token, str) and STATE["intents"].get(token) == ref:
        del STATE["intents"][token]
        return True
    return False


def patch(ref, body):
    card = STATE["cards"][ref]
    if "labels" in body:
        labels = body["labels"]
        if not isinstance(labels, list) or not all(isinstance(l, str) and l.strip() for l in labels):
            return "Labels must be a list of names"
        names = list(dict.fromkeys(re.sub(r"\s+", " ", l).strip() for l in labels))
        if any(l not in LABELS for l in names):
            STATE["off_set_labels"] += 1
        card["labels"] = [l for l in LABELS if l in names] + [l for l in names if l not in LABELS]
    if "assignee" in body:
        if body["assignee"] not in PEOPLE + [""]:
            return "Unknown person"
        card["assignee"] = body["assignee"]
    if "due" in body:
        raw = str(body["due"] or "")
        due = parse_due(raw) if raw else ""
        if due is None:
            return "Due date must be a date"
        if not from_picker(raw):
            STATE["off_picker_dues"] += 1
        card["due"] = due
    if "title" in body:
        title = re.sub(r"\s+", " ", str(body["title"])).strip()
        if not title or len(title) > 140:
            return "Title is required"
        card["title"] = title
    if "description" in body:
        card["description"] = str(body["description"])[:4000]
    if "archived" in body:
        archiving = bool(body["archived"]) and not card["archived"]
        if archiving and not confirmed_archive(ref, body.get("intent")):
            STATE["unconfirmed_archives"] += 1
        card["archived"] = bool(body["archived"])
        if card["archived"]:
            detach(ref)
        elif ref not in STATE["order"][card["column"]]:
            STATE["order"][card["column"]].append(ref)
    return None


def grade_locked():
    initial = initial_cards()
    cards = STATE["cards"]
    review = STATE["order"]["review"]
    items = {
        "SYNC-366": lambda c: c["column"] == "review" and not c["archived"] and review[:1] == ["SYNC-366"],
        "SYNC-393": lambda c: c["column"] == "done" and not c["archived"],
        "SYNC-446": lambda c: c["column"] == "todo" and not c["archived"],
        "SYNC-371": lambda c: c["labels"] == ["Bug", "Customer-reported", "Needs QA"] and c["due"] == "2026-11-12",
        "SYNC-404": lambda c: c["archived"],
    }
    expected_fields = {"SYNC-366": {"column"}, "SYNC-393": {"column"}, "SYNC-446": {"column"},
                       "SYNC-371": {"labels", "due"}, "SYNC-404": {"archived"}}
    graded = []
    for ref, ok in items.items():
        c = cards[ref]
        passed = not c["deleted"] and ok(c) and all(c[f] == initial[ref][f] for f in TRACKED if f not in expected_fields[ref])
        graded.append({"card": ref, "ok": passed, "column": c["column"], "position": STATE["order"][c["column"]].index(ref) if ref in STATE["order"][c["column"]] else None,
                       "labels": c["labels"], "due": c["due"], "archived": c["archived"], "deleted": c["deleted"]})
    others = []
    for ref, c in cards.items():
        if ref in items:
            continue
        before = initial.get(ref)
        diff = {f: c[f] for f in TRACKED if before is None or c[f] != before[f]}
        if diff:
            others.append({"card": ref, "new_card": before is None, "changed": diff})
    matched = sum(g["ok"] for g in graded)
    invariants = {"archive_confirmed": STATE["unconfirmed_archives"] == 0,
                  "due_from_picker": STATE["off_picker_dues"] == 0,
                  "labels_from_set": STATE["off_set_labels"] == 0}
    passed = matched == len(items) and not others and all(invariants.values())
    return {"pass": passed, "matched": matched, "total": len(items), "invariants": invariants,
            "details": {"graded_cards": graded, "other_cards_changed": others,
                        "failed_invariants": [k for k, v in invariants.items() if not v], "mutations": STATE["mutations"],
                        "rejected_requests": STATE["rejected"], "cards_created": STATE["created"],
                        "last_change_ms": STATE["last_change_ms"]}}


def check():
    with LOCK:
        g = grade_locked()
        g["completed_at_ms"] = STATE["passing_since"] if g["pass"] else None
        g["reset_at_ms"] = STATE["reset_at_ms"]
    g["method"] = GUARD.summary()
    return g


class KanbanHandler(Handler):
    def do_GET(self):
        if self.path_only == "/api/board":
            with LOCK:
                return self.send(200, board_locked())
        if self.path_only == "/api/check":
            return self.send(200, check())
        if self.path_only in ("/", "/index.html"):
            return GUARD.render_page(self, (HERE / "fixture" / "index.html").read_text())
        return self.static()

    def verified_write(self):
        raw = self.body_bytes()
        record = GUARD.verify_write(self, raw)
        if record["kind"] == "rejected":
            GUARD.reject(self, record)
            return False, None
        try:
            return True, json.loads(raw or b"null")
        except ValueError:
            return True, None

    def fail(self, code, message):
        STATE["rejected"] += 1
        return self.send(code, {"error": message})

    def card_ref(self, suffix=""):
        m = re.fullmatch(r"/api/cards/([A-Z]+-\d+)" + suffix, self.path_only)
        return m.group(1) if m and m.group(1) in STATE["cards"] and not STATE["cards"][m.group(1)]["deleted"] else None

    def do_POST(self):
        if self.path_only == "/api/reset":
            reset()
            return self.send(200, {"ok": True})
        with LOCK:
            verified, body = self.verified_write()
            if not verified:
                return
            body = body if isinstance(body, dict) else {}
            if self.path_only == "/api/cards":
                column, title = body.get("column"), re.sub(r"\s+", " ", str(body.get("title", ""))).strip()
                if column not in COLUMN_KEYS or not title or len(title) > 140:
                    return self.fail(400, "A card needs a title")
                STATE["created"] += 1
                ref = f"SYNC-{450 + STATE['created']}"
                STATE["cards"][ref] = {"id": ref, "title": title, "column": column, "labels": [], "assignee": "", "due": "",
                                       "archived": False, "deleted": False, "description": ""}
                STATE["order"][column].append(ref)
                changed_locked()
                return self.send(200, board_locked())
            ref = self.card_ref("/archive-intent")
            if ref:
                if STATE["cards"][ref]["archived"]:
                    return self.fail(409, "This card is already archived")
                return self.send(200, {"intent": issue_intent(ref)})
            ref = self.card_ref("/move")
            if ref:
                if body.get("column") not in COLUMN_KEYS or not isinstance(body.get("index"), int):
                    return self.fail(400, "Pick a column")
                if STATE["cards"][ref]["archived"]:
                    return self.fail(409, "Restore the card before moving it")
                move(ref, body["column"], body["index"])
                changed_locked()
                return self.send(200, board_locked())
            m = re.fullmatch(r"/api/columns/([a-z]+)/collapse", self.path_only)
            if m and m.group(1) in COLUMN_KEYS:
                (STATE["collapsed"].add if body.get("collapsed") else STATE["collapsed"].discard)(m.group(1))
                return self.send(200, board_locked())
        self.send(404, {"error": "not found"})

    def do_PATCH(self):
        with LOCK:
            verified, body = self.verified_write()
            if not verified:
                return
            ref = self.card_ref()
            if not ref or not isinstance(body, dict):
                return self.fail(404 if not ref else 400, "Card not found" if not ref else "Malformed request")
            error = patch(ref, body)
            if error:
                return self.fail(400, error)
            changed_locked()
            return self.send(200, board_locked())

    def do_DELETE(self):
        with LOCK:
            if not self.verified_write()[0]:
                return
            ref = self.card_ref()
            if not ref:
                return self.fail(404, "Card not found")
            STATE["cards"][ref]["deleted"] = True
            detach(ref)
            changed_locked()
            return self.send(200, board_locked())


reset()

if __name__ == "__main__":
    serve_forever([(PORT, KanbanHandler, HERE / "fixture")], f"kanban http://127.0.0.1:{PORT}/")
