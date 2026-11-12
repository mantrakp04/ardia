#!/usr/bin/env python3
import json
import re
import sys
import threading
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from benchhttp import Handler, now_ms, serve_forever

INBOX_PORT, DIRECTORY_PORT, SCHEDULER_PORT = 8851, 8852, 8853
HERE = Path(__file__).resolve().parent
DATA = json.loads((HERE / "data.json").read_text())
ORGANIZER = "jordan@northwind.dev"
EXPECTED = {
    "title": "kontor integration kickoff",
    "date": "2026-11-11",
    "start": "14:00",
    "duration": 45,
    "room": "mission",
    "attendees": {"priya.raman@northwind.dev", "marcus.chen@northwind.dev", "sofia.alvarez@northwind.dev",
                  "hana.kim@northwind.dev", "alex.morgan@northwind.dev", "omar.haddad@northwind.dev", "lena.vogt@kontor.io"},
}
DURATIONS = (15, 30, 45, 60, 90, 120)
EMAIL_RE = re.compile(r"[^@\s<>,;]+@[^@\s<>,;]+\.[a-z]{2,}", re.I)
TEAMS = {t["id"]: t for t in DATA["teams"]}
PEOPLE = {p["id"]: p for p in DATA["people"]}
BY_EMAIL = {p["email"]: p for p in DATA["people"]}
ROOMS = {r["id"]: r for r in DATA["rooms"]}
LOCK = threading.Lock()
STATE = {}


def reset_state():
    with LOCK:
        STATE.update(
            read=set(),
            meetings=[dict(m, attendees=list(m["attendees"]), id=f"mtg_{i:03d}", seeded=True) for i, m in enumerate(DATA["meetings"])],
            next_id=len(DATA["meetings"]),
            created=0, edits=0, deletes=0, rejected=0,
            reset_at_ms=now_ms(),
        )


def minutes(hhmm):
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def overlaps(a_start, a_end, b_start, b_end):
    return a_start < b_end and b_start < a_end


def room_busy(room_id, date, start, duration, ignore_id=None):
    s, e = minutes(start), minutes(start) + duration
    for b in DATA["room_bookings"]:
        if b["room"] == room_id and b["date"] == date and overlaps(s, e, minutes(b["start"]), minutes(b["end"])):
            return True
    with LOCK:
        meetings = list(STATE["meetings"])
    return any(m["room"] == room_id and m["date"] == date and m["id"] != ignore_id and not m.get("seeded")
               and overlaps(s, e, minutes(m["start"]), minutes(m["start"]) + m["duration"]) for m in meetings)


def person_card(p):
    team = TEAMS.get(p["team"])
    return {"id": p["id"], "name": p["name"], "title": p["title"], "email": p["email"], "team": team["name"] if team else "",
            "team_id": p["team"], "location": p["location"], "status": p.get("status", ""), "photo_hue": p["hue"]}


def matches(p, q):
    hay = f"{p['name']} {p['email']} {p['title']} {TEAMS[p['team']]['name']}".lower()
    return all(t in hay for t in q.lower().split())


def validate_meeting(body):
    errors = {}
    title = re.sub(r"\s+", " ", str(body.get("title", ""))).strip()
    if not title:
        errors["title"] = "Add a title."
    date = str(body.get("date", "")).strip()
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        errors["date"] = "Choose a date."
    start = str(body.get("start", "")).strip()
    if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", start):
        errors["start"] = "Choose a start time."
    try:
        duration = int(body.get("duration"))
    except (TypeError, ValueError):
        duration = 0
    if duration not in DURATIONS:
        errors["duration"] = "Choose a duration."
    attendees = []
    for raw in body.get("attendees") or []:
        email = str(raw).strip().lower()
        if not EMAIL_RE.fullmatch(email):
            errors["attendees"] = f"“{raw}” isn’t a valid email address."
        elif email != ORGANIZER and email not in attendees:
            attendees.append(email)
    room = str(body.get("room") or "").strip()
    if room and room not in ROOMS:
        errors["room"] = "That room doesn’t exist."
    return errors, {"title": title, "date": date, "start": start, "duration": duration, "attendees": attendees,
                    "room": room, "description": str(body.get("description", ""))[:2000]}


def meeting_view(m):
    view = dict(m)
    view["guests"] = [person_card(BY_EMAIL[e]) if e in BY_EMAIL else {"email": e, "name": e, "external": True} for e in m["attendees"]]
    view["room_name"] = ROOMS[m["room"]]["name"] if m["room"] else ""
    view["room_declined"] = bool(m["room"]) and not m.get("seeded") and room_busy(m["room"], m["date"], m["start"], m["duration"], m["id"])
    return view


def check():
    with LOCK:
        mine = [m for m in STATE["meetings"] if not m.get("seeded")]
        counters = {k: STATE[k] for k in ("created", "edits", "deletes", "rejected")}
        reset_at = STATE["reset_at_ms"]
    total = 6
    if not mine:
        return {"pass": False, "matched": 0, "total": total, "completed_at_ms": None, "reset_at_ms": reset_at,
                "details": dict(counters, meetings_now=0, wrong=["no meeting created"], meeting=None)}
    m = max(mine, key=lambda x: x["saved_at_ms"])
    got = set(m["attendees"])
    busy = bool(m["room"]) and room_busy(m["room"], m["date"], m["start"], m["duration"], m["id"])
    results = {
        "title": m["title"].casefold() == EXPECTED["title"],
        "date": m["date"] == EXPECTED["date"],
        "start": m["start"] == EXPECTED["start"],
        "duration": m["duration"] == EXPECTED["duration"],
        "room": m["room"] == EXPECTED["room"] and not busy,
        "attendees": got == EXPECTED["attendees"],
    }
    passed = all(results.values())
    return {"pass": passed, "matched": sum(results.values()), "total": total,
            "completed_at_ms": m["saved_at_ms"] if passed else None, "reset_at_ms": reset_at,
            "details": dict(counters, meetings_now=len(mine), wrong=sorted(k for k, ok in results.items() if not ok),
                            attendees_missing=len(EXPECTED["attendees"] - got), attendees_unexpected=sorted(got - EXPECTED["attendees"]),
                            room_busy=busy,
                            meeting={k: m[k] for k in ("title", "date", "start", "duration", "room", "attendees")})}


class InboxHandler(Handler):
    def do_GET(self):
        path = self.path_only
        if path == "/api/messages":
            q = self.query.get("q", "").strip().lower()
            with LOCK:
                read = set(STATE["read"])
            items = []
            for msg in DATA["emails"]:
                hay = f"{msg['from']['name']} {msg['from']['email']} {msg['subject']} {msg['body']}".lower()
                if q and not all(t in hay for t in q.split()):
                    continue
                items.append({"id": msg["id"], "from": msg["from"], "subject": msg["subject"], "date": msg["date"],
                              "snippet": re.sub(r"\s+", " ", msg["body"])[:140], "unread": msg.get("unread", False) and msg["id"] not in read,
                              "starred": msg.get("starred", False)})
            items.sort(key=lambda x: x["date"], reverse=True)
            return self.send(200, {"total": len(items), "messages": items})
        m = re.fullmatch(r"/api/messages/([a-z0-9]+)", path)
        if m:
            msg = next((x for x in DATA["emails"] if x["id"] == m.group(1)), None)
            return self.send(200, msg) if msg else self.send(404, {"error": "not found"})
        return self.static()

    def do_POST(self):
        m = re.fullmatch(r"/api/messages/([a-z0-9]+)/read", self.path_only)
        if m:
            with LOCK:
                STATE["read"].add(m.group(1))
            return self.send(200, {"ok": True})
        self.send(404, {"error": "not found"})


class DirectoryHandler(Handler):
    def do_GET(self):
        path = self.path_only
        if path == "/api/people":
            q = self.query.get("q", "").strip()
            hits = [person_card(p) for p in DATA["people"] if q and matches(p, q)]
            return self.send(200, {"total": len(hits), "people": sorted(hits, key=lambda p: p["name"])[:50]})
        if path == "/api/teams":
            return self.send(200, [dict(t, size=sum(1 for p in DATA["people"] if p["team"] == t["id"])) for t in DATA["teams"]])
        m = re.fullmatch(r"/api/teams/([a-z-]+)", path)
        if m and m.group(1) in TEAMS:
            team = TEAMS[m.group(1)]
            members = sorted((person_card(p) for p in DATA["people"] if p["team"] == team["id"]),
                             key=lambda p: (p["id"] != team["lead"], p["name"]))
            return self.send(200, dict(team, lead_name=PEOPLE[team["lead"]]["name"], members=members))
        m = re.fullmatch(r"/api/people/([a-z0-9-]+)", path)
        if m and m.group(1) in PEOPLE:
            p = PEOPLE[m.group(1)]
            card = person_card(p)
            manager = PEOPLE.get(p.get("manager", ""))
            card.update(phone=p["phone"], timezone=p["tz"], joined=p["joined"], pronouns=p.get("pronouns", ""),
                        manager={"id": manager["id"], "name": manager["name"], "title": manager["title"]} if manager else None,
                        history=p.get("history", []), about=p.get("about", ""),
                        reports=[person_card(r) for r in DATA["people"] if r.get("manager") == p["id"]])
            return self.send(200, card)
        if path.startswith("/api/"):
            return self.send(404, {"error": "not found"})
        return self.static()


class SchedulerHandler(Handler):
    def do_GET(self):
        path = self.path_only
        if path == "/api/check":
            return self.send(200, check())
        if path == "/api/meetings":
            start, end = self.query.get("from", ""), self.query.get("to", "")
            with LOCK:
                meetings = list(STATE["meetings"])
            return self.send(200, [meeting_view(m) for m in meetings if start <= m["date"] <= end])
        if path == "/api/people":
            q = self.query.get("q", "").strip()
            hits = [p for p in DATA["people"] if q and p["email"] != ORGANIZER and matches(p, q)]
            return self.send(200, [{"name": p["name"], "email": p["email"], "title": p["title"], "photo_hue": p["hue"]}
                                   for p in sorted(hits, key=lambda p: p["name"])[:8]])
        if path == "/api/rooms":
            date, start = self.query.get("date", ""), self.query.get("start", "")
            try:
                duration = int(self.query.get("duration", "30"))
                minutes(start)
                datetime.strptime(date, "%Y-%m-%d")
            except ValueError:
                return self.send(400, {"error": "Choose a date and time first."})
            ignore = self.query.get("meeting")
            return self.send(200, [dict(r, available=not room_busy(r["id"], date, start, duration, ignore)) for r in DATA["rooms"]])
        return self.static()

    def save(self, meeting_id=None):
        body = self.body_json()
        if not isinstance(body, dict):
            return self.send(400, {"error": "Invalid request."})
        errors, meeting = validate_meeting(body)
        if errors:
            with LOCK:
                STATE["rejected"] += 1
            return self.send(422, {"errors": errors})
        with LOCK:
            if meeting_id is None:
                meeting.update(id=f"mtg_{STATE['next_id']:03d}", organizer=ORGANIZER, saved_at_ms=now_ms())
                STATE["next_id"] += 1
                STATE["created"] += 1
                STATE["meetings"].append(meeting)
            else:
                existing = next((m for m in STATE["meetings"] if m["id"] == meeting_id and not m.get("seeded")), None)
                if not existing:
                    return self.send(404, {"error": "This meeting can’t be edited."})
                existing.update(meeting, saved_at_ms=now_ms())
                STATE["edits"] += 1
                meeting = existing
        return self.send(200 if meeting_id else 201, meeting_view(meeting))

    def do_POST(self):
        if self.path_only == "/api/reset":
            reset_state()
            return self.send(200, {"ok": True})
        if self.path_only == "/api/meetings":
            return self.save()
        self.send(404, {"error": "not found"})

    def do_PUT(self):
        m = re.fullmatch(r"/api/meetings/(mtg_\d+)", self.path_only)
        return self.save(m.group(1)) if m else self.send(404, {"error": "not found"})

    def do_DELETE(self):
        m = re.fullmatch(r"/api/meetings/(mtg_\d+)", self.path_only)
        with LOCK:
            before = len(STATE["meetings"])
            if m:
                STATE["meetings"] = [x for x in STATE["meetings"] if x["id"] != m.group(1) or x.get("seeded")]
            removed = before - len(STATE["meetings"])
            STATE["deletes"] += removed
        return self.send(200, {"ok": True}) if removed else self.send(404, {"error": "not found"})


if __name__ == "__main__":
    reset_state()
    fixture = HERE / "fixture"
    serve_forever([(INBOX_PORT, InboxHandler, fixture / "inbox"), (DIRECTORY_PORT, DirectoryHandler, fixture / "directory"),
                   (SCHEDULER_PORT, SchedulerHandler, fixture / "scheduler")],
                  f"multitab inbox http://127.0.0.1:{INBOX_PORT}/ directory http://127.0.0.1:{DIRECTORY_PORT}/ scheduler http://127.0.0.1:{SCHEDULER_PORT}/")
