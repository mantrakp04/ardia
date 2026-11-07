#!/usr/bin/env python3
import random
import re
import sys
import threading
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from benchhttp import Handler, now_ms, serve_forever

PORT = 8811
HERE = Path(__file__).resolve().parent
TODAY = date(2026, 11, 6)
LAST_BOOKABLE = date(2027, 8, 31)

AIRPORTS = {
    "SFO": "San Francisco, CA", "OAK": "Oakland, CA", "SJC": "San Jose, CA", "SMF": "Sacramento, CA",
    "LAX": "Los Angeles, CA", "BUR": "Burbank, CA", "SAN": "San Diego, CA", "PSP": "Palm Springs, CA",
    "SEA": "Seattle–Tacoma, WA", "PAE": "Everett, WA – Paine Field", "GEG": "Spokane, WA", "PDX": "Portland, OR",
    "BOI": "Boise, ID", "SLC": "Salt Lake City, UT", "DEN": "Denver, CO", "PHX": "Phoenix, AZ",
    "LAS": "Las Vegas, NV", "RNO": "Reno/Tahoe, NV", "ANC": "Anchorage, AK", "HNL": "Honolulu, HI",
}
ROUTES = {
    "SFO": ["SEA", "PAE", "PDX", "LAX", "SAN", "BUR", "PSP", "LAS", "DEN", "PHX", "SLC", "BOI", "GEG", "HNL", "ANC"],
    "OAK": ["SEA", "PDX", "LAS", "BUR", "SAN", "BOI", "HNL"],
    "SJC": ["SEA", "PDX", "LAX", "SAN", "PSP", "PHX"],
    "SMF": ["SEA", "PDX", "SAN", "LAX"],
    "LAX": ["SFO", "SJC", "SMF", "SEA", "PDX", "BOI", "RNO", "HNL", "ANC"],
    "BUR": ["SFO", "OAK", "SEA", "PDX"],
    "SAN": ["SFO", "OAK", "SJC", "SMF", "SEA", "PAE", "PDX", "BOI"],
    "PSP": ["SFO", "SJC", "SEA", "PDX"],
    "SEA": ["SFO", "OAK", "SJC", "SMF", "LAX", "BUR", "SAN", "PSP", "PDX", "GEG", "BOI", "ANC", "HNL", "PHX", "DEN"],
    "PAE": ["SFO", "SAN", "LAS", "PHX"],
    "GEG": ["SEA", "SFO", "PDX"],
    "PDX": ["SFO", "OAK", "SJC", "SMF", "LAX", "BUR", "SAN", "PSP", "SEA", "GEG", "BOI", "ANC"],
    "BOI": ["SFO", "OAK", "LAX", "SAN", "SEA", "PDX"],
    "SLC": ["SFO", "SEA"], "DEN": ["SFO", "SEA"], "PHX": ["SFO", "SJC", "SEA", "PAE"],
    "LAS": ["SFO", "OAK", "PAE"], "RNO": ["LAX"], "ANC": ["SEA", "PDX", "LAX", "SFO"],
    "HNL": ["SFO", "OAK", "LAX", "SEA"],
}
SFO_SEA = [
    ("AQ1201", "06:10", 125, None, 89), ("AQ1203", "07:25", 127, None, 104), ("AQ1205", "08:55", 126, None, 79),
    ("AQ2211", "09:05", 255, ("PDX", 50), 64), ("AQ1207", "09:40", 128, None, 99), ("AQ2215", "10:30", 262, ("SMF", 65), 74),
    ("AQ1209", "11:15", 127, None, 84), ("AQ1211", "13:05", 129, None, 109), ("AQ2219", "14:40", 248, ("PDX", 45), 69),
    ("AQ1213", "15:50", 128, None, 129), ("AQ1215", "18:35", 126, None, 119), ("AQ1217", "21:10", 125, None, 74),
]
FARES = {"economy": [("B", "Basic", 0), ("M", "Main", 40), ("F", "Flexi", 150)],
         "first": [("P", "First", 0), ("R", "First Flexi", 210)]}
ECONOMY_ROWS = [r for r in range(7, 31) if r != 13]
PREFERRED_ROWS, EXIT_ROWS = {7, 8, 9}, {14, 15}
LETTERS = "ABCDEF"
SEAT_KIND = {"A": "window", "B": "middle", "C": "aisle", "D": "aisle", "E": "middle", "F": "window"}
TARGET_FLIGHT = "AQ1207-20261203"
TARGET_FREE = {7: "AB", 8: "D", 9: "CE", 10: "BC", 11: "F", 12: "AC", 14: "ABF", 15: "EF", 16: "CD", 17: "B", 18: "E",
               20: "A", 21: "CDE", 23: "BC", 24: "EF", 26: "D", 27: "AB", 28: "C", 29: "BE", 30: "BC"}
EXPECTED_TRAVELERS = [("jordan avery lee", "1991-03-14"), ("sam okafor", "1990-07-02")]
EXPECTED_CONTACT = ("jordan@northwind.dev", "+1", "4155550198")
NAME_RE = re.compile(r"^[A-Za-z][A-Za-z' -]{0,39}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")
PHONE_RE = re.compile(r"^\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}$")
ROUTE_INDEX = {pair: k for k, pair in enumerate(sorted((o, d) for o, ds in ROUTES.items() for d in ds))}
FIRST_ROWS, FIRST_LETTERS = [1, 2, 3, 4], "ACDF"
LOCK = threading.Lock()
STATE = {}


def reset_state():
    STATE.update(bookings=[], validations=0, validation_errors=0, booking_errors=0, reset_at_ms=now_ms())


def minutes(hhmm):
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def clock(total):
    return f"{(total // 60) % 24:02d}:{total % 60:02d}"


def schedule(origin, dest, day):
    if (origin, dest) == ("SFO", "SEA"):
        return SFO_SEA
    rng = random.Random(f"{origin}{dest}")
    base = 70 + (abs(hash_text(origin) - hash_text(dest)) % 220)
    out, start = [], 6 * 60 + rng.randint(0, 50)
    for i in range(rng.randint(4, 9)):
        stop = None if rng.random() > 0.3 else (rng.choice([c for c in ("PDX", "SEA", "SFO", "LAX") if c not in (origin, dest)]), rng.randint(40, 95))
        duration = base + (base // 2 + stop[1] + 30 if stop else 0)
        out.append((f"AQ{3000 + ROUTE_INDEX[(origin, dest)] * 12 + i}", clock(start), duration, stop, 59 + rng.randint(0, 14) * 5))
        start += rng.randint(60, 170)
        if start > 22 * 60:
            break
    return out


def hash_text(text):
    return sum((i + 1) * ord(c) for i, c in enumerate(text))


def flights_for(origin, dest, day, cabin, pax):
    rows = []
    for number, dep, duration, stop, basic in schedule(origin, dest, day):
        fid = f"{number}-{day.strftime('%Y%m%d')}"
        rng = random.Random(fid)
        bump = 0 if fid.endswith("20261203") and origin == "SFO" else rng.choice([-10, 0, 0, 10, 20, 30])
        fares = []
        for code, name, extra in FARES[cabin]:
            price = (basic + bump + extra) if cabin == "economy" else (basic + bump) * 3 + 120 + extra
            left = rng.choice([None, None, None, 2, 4, 7])
            if fid == TARGET_FLIGHT and cabin == "economy":
                left = {"B": 3, "M": 6, "F": None}[code]
            sold_out = left is not None and left < pax
            fares.append({"code": code, "name": name, "price": price, "seats_left": left, "sold_out": sold_out})
        dep_min = minutes(dep)
        rows.append({"id": fid, "number": number, "origin": origin, "destination": dest, "date": day.isoformat(),
                     "depart": dep, "arrive": clock(dep_min + duration), "arrive_next_day": dep_min + duration >= 1440,
                     "duration_min": duration, "stops": 1 if stop else 0,
                     "connection": {"airport": stop[0], "layover_min": stop[1]} if stop else None,
                     "aircraft": "Airbus A321neo" if not stop else "Embraer 175 / Airbus A320", "fares": fares})
    return rows


def find_flight(fid):
    try:
        number, stamp = fid.split("-")
        day = date(int(stamp[:4]), int(stamp[4:6]), int(stamp[6:]))
    except (ValueError, AttributeError):
        return None
    for origin, dests in ROUTES.items():
        for dest in dests:
            if any(row[0] == number for row in schedule(origin, dest, day)):
                return {"origin": origin, "destination": dest, "day": day, "number": number}
    return None


def seat_map(fid):
    rng = random.Random("seats" + fid)
    rows = [{"row": r, "kind": "first", "fee": 0,
             "seats": [{"id": f"{r}{c}", "letter": c, "position": "window" if c in "AF" else "aisle",
                        "available": (fid != TARGET_FLIGHT and rng.random() < 0.4) or (fid == TARGET_FLIGHT and r == 4 and c in "CD")}
                       for c in FIRST_LETTERS]} for r in FIRST_ROWS]
    for r in ECONOMY_ROWS:
        free = TARGET_FREE.get(r, "") if fid == TARGET_FLIGHT else "".join(c for c in LETTERS if rng.random() < 0.35)
        kind = "exit" if r in EXIT_ROWS else "preferred" if r in PREFERRED_ROWS else "standard"
        fee = 39 if kind == "exit" else 25 if kind == "preferred" else 0
        rows.append({"row": r, "kind": kind, "fee": fee,
                     "seats": [{"id": f"{r}{c}", "letter": c, "position": SEAT_KIND[c], "available": c in free} for c in LETTERS]})
    return {"flight": fid, "aircraft": "Airbus A321neo", "rows": rows}


def seat_info(fid, seat_id):
    for row in seat_map(fid)["rows"]:
        for seat in row["seats"]:
            if seat["id"] == seat_id:
                return row, seat
    return None, None


def clean(value):
    return str(value or "").strip()


def validate(body, final):
    errors = []
    add = lambda field, message: errors.append({"field": field, "message": message})
    flight = find_flight(clean(body.get("flight")))
    cabin = clean(body.get("cabin")) or "economy"
    fare = clean(body.get("fare"))
    if not flight or fare not in {c for c, _, _ in FARES.get(cabin, [])}:
        add("flight", "This flight or fare is no longer available. Please search again.")
        return errors
    travelers = body.get("passengers") if isinstance(body.get("passengers"), list) else []
    seats = body.get("seats") if isinstance(body.get("seats"), list) else []
    if not 1 <= len(travelers) <= 13:
        add("passengers", "Add at least one passenger.")
    for i, p in enumerate(travelers):
        p = p if isinstance(p, dict) else {}
        n = i + 1
        for key, label in (("first", "first name"), ("last", "last name")):
            if not clean(p.get(key)):
                add(f"passengers.{i}.{key}", f"Passenger {n}: enter the {label} exactly as on the ID.")
            elif not NAME_RE.match(clean(p.get(key))):
                add(f"passengers.{i}.{key}", f"Passenger {n}: use letters, spaces, hyphens and apostrophes only.")
        if not clean(p.get("middle")) and not p.get("no_middle"):
            add(f"passengers.{i}.middle", f"Passenger {n}: enter the middle name as on the ID, or select “No middle name on ID”.")
        dob = clean(p.get("dob"))
        try:
            born = date.fromisoformat(dob)
            if born >= TODAY or born.year < 1900:
                raise ValueError
        except ValueError:
            add(f"passengers.{i}.dob", f"Passenger {n}: enter a valid date of birth (MM/DD/YYYY).")
    contact = body.get("contact") if isinstance(body.get("contact"), dict) else {}
    if not EMAIL_RE.match(clean(contact.get("email"))):
        add("contact.email", "Enter a valid email address, like name@example.com.")
    phone = clean(contact.get("phone"))
    if clean(contact.get("country")) == "+1" and not PHONE_RE.match(phone):
        add("contact.phone", "Enter a 10-digit US or Canada number without the country code, like 415-555-0123.")
    elif not re.fullmatch(r"[\d ().-]{6,18}", phone):
        add("contact.phone", "Enter a valid mobile number.")
    seat_choice = fare not in ("B",)
    taken = set()
    for i in range(len(travelers)):
        seat_id = clean(seats[i]) if i < len(seats) else ""
        if not seat_choice:
            if seat_id:
                add(f"seats.{i}", "Seat selection isn't included with Basic.")
            continue
        if not seat_id:
            add(f"seats.{i}", f"Choose a seat for passenger {i + 1}.")
            continue
        row, seat = seat_info(clean(body.get("flight")), seat_id)
        if not seat or not seat["available"] or seat_id in taken:
            add(f"seats.{i}", f"Seat {seat_id} is no longer available. Choose another seat.")
            continue
        taken.add(seat_id)
        if (row["kind"] == "first") != (cabin == "first"):
            add(f"seats.{i}", f"Seat {seat_id} isn't available with your fare. Choose another seat.")
            continue
        if row["kind"] == "exit" and not body.get("exit_ack"):
            add("exit_ack", "Confirm that passengers seated in an exit row meet the exit row requirements.")
    if final and not body.get("fare_rules"):
        add("fare_rules", "Review and accept the fare rules to continue.")
    return errors


def price_of(body):
    flight = find_flight(clean(body.get("flight")))
    cabin = clean(body.get("cabin")) or "economy"
    pax = len(body.get("passengers") or [])
    rows = flights_for(flight["origin"], flight["destination"], flight["day"], cabin, pax)
    row = next(r for r in rows if r["id"] == clean(body.get("flight")))
    fare = next(f for f in row["fares"] if f["code"] == clean(body.get("fare")))
    seat_fees = sum((seat_info(row["id"], clean(s))[0] or {"fee": 0})["fee"] for s in body.get("seats") or [] if s)
    base = fare["price"] * pax
    taxes = round(base * 0.075 + pax * (5.6 + 4.5 * (1 + row["stops"])) , 2)
    return row, fare, {"fare_total": base, "taxes": taxes, "seat_fees": seat_fees, "total": round(base + taxes + seat_fees, 2)}


def normalize_name(p):
    parts = [clean(p.get("first")), "" if p.get("no_middle") else clean(p.get("middle")), clean(p.get("last"))]
    return re.sub(r"\s+", " ", " ".join(parts)).strip().lower()


def seats_ok(fid, seat_ids):
    if len(seat_ids) != 2 or not all(seat_ids):
        return False
    infos = [seat_info(fid, s) for s in seat_ids]
    if any(r is None for r, _ in infos):
        return False
    (r1, s1), (r2, s2) = infos
    pair = "".join(sorted(s1["letter"] + s2["letter"]))
    return r1["row"] == r2["row"] and pair in ("AB", "BC", "DE", "EF") and "window" in (s1["position"], s2["position"]) \
        and r1["kind"] == "standard"


def check():
    with LOCK:
        bookings = list(STATE["bookings"])
        counters = {k: STATE[k] for k in ("validations", "validation_errors", "booking_errors")}
        reset_at = STATE["reset_at_ms"]
    details = dict(counters, bookings_confirmed=len(bookings), wrong=[])
    if not bookings:
        details["wrong"] = ["no confirmed booking"]
        return {"pass": False, "matched": 0, "total": 8, "completed_at_ms": None, "reset_at_ms": reset_at, "details": details}
    b = bookings[-1]
    req = b["request"]
    travelers = [{"name": normalize_name(p), "dob": clean(p.get("dob"))} for p in req["passengers"]]
    contact = req["contact"]
    phone_digits = re.sub(r"\D", "", clean(contact.get("phone")))
    produced = {"flight": req["flight"], "fare": b["fare_name"], "passengers": travelers, "email": clean(contact.get("email")),
                "phone": f"{clean(contact.get('country'))} {clean(contact.get('phone'))}", "seats": req["seats"],
                "confirmation": b["code"]}
    found = {(t["name"], t["dob"]) for t in travelers}
    items = {
        "flight": req["flight"] == TARGET_FLIGHT,
        "fare": req["fare"] == "M" and req.get("cabin", "economy") == "economy",
        "passenger_count": len(travelers) == 2,
        "traveler_1": EXPECTED_TRAVELERS[0] in found,
        "traveler_2": EXPECTED_TRAVELERS[1] in found,
        "contact_email": produced["email"].lower() == EXPECTED_CONTACT[0],
        "contact_phone": clean(contact.get("country")) == EXPECTED_CONTACT[1] and phone_digits == EXPECTED_CONTACT[2],
        "seats": seats_ok(req["flight"], [clean(s) for s in req["seats"]]),
    }
    passed = all(items.values())
    details.update(wrong=[k for k, ok in items.items() if not ok], produced=produced)
    return {"pass": passed, "matched": sum(items.values()), "total": len(items),
            "completed_at_ms": b["at_ms"] if passed else None, "reset_at_ms": reset_at, "details": details}


class BookingHandler(Handler):
    def do_GET(self):
        path, q = self.path_only, self.query
        if path == "/api/check":
            return self.send(200, check())
        if path == "/api/airports":
            return self.send(200, [{"code": c, "city": n, "routes": ROUTES[c]} for c, n in sorted(AIRPORTS.items(), key=lambda kv: kv[1])])
        if path == "/api/availability":
            origin, dest, cabin = q.get("origin", ""), q.get("destination", ""), q.get("cabin", "economy")
            try:
                day = date.fromisoformat(q.get("date", ""))
                pax = int(q.get("adults", "1")) + int(q.get("children", "0"))
            except ValueError:
                return self.send(400, {"error": "Enter a valid travel date."})
            if dest not in ROUTES.get(origin, []) or cabin not in FARES:
                return self.send(404, {"error": "We don't fly this route."})
            if not TODAY <= day <= LAST_BOOKABLE:
                return self.send(400, {"error": "Choose a date between today and Aug 31, 2027."})
            return self.send(200, {"flights": flights_for(origin, dest, day, cabin, pax)})
        if path == "/api/seatmap":
            if not find_flight(q.get("flight", "")):
                return self.send(404, {"error": "Seat map unavailable."})
            return self.send(200, seat_map(q["flight"]))
        if path.startswith("/api/"):
            return self.send(404, {"error": "not found"})
        return self.static(path if "." in path.rsplit("/", 1)[-1] else "/")

    def do_POST(self):
        path = self.path_only
        if path == "/api/reset":
            with LOCK:
                reset_state()
            return self.send(200, {"ok": True})
        if path not in ("/api/passengers/validate", "/api/bookings"):
            return self.send(404, {"error": "not found"})
        body = self.body_json()
        if not isinstance(body, dict):
            return self.send(400, {"error": "bad request"})
        final = path == "/api/bookings"
        errors = validate(body, final)
        with LOCK:
            if final:
                STATE["booking_errors"] += bool(errors)
            else:
                STATE["validations"] += 1
                STATE["validation_errors"] += len(errors)
        if errors:
            return self.send(422, {"errors": errors})
        row, fare, price = price_of(body)
        if not final:
            return self.send(200, {"ok": True, "price": price})
        with LOCK:
            code_rng = random.Random(len(STATE["bookings"]) + STATE["reset_at_ms"])
            code = "".join(code_rng.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
            record = {"code": code, "at_ms": now_ms(), "fare_name": fare["name"], "price": price,
                      "request": {"flight": row["id"], "cabin": clean(body.get("cabin")) or "economy", "fare": fare["code"],
                                  "passengers": body["passengers"], "contact": body["contact"],
                                  "seats": [clean(s) for s in (body.get("seats") or [])]}}
            STATE["bookings"].append(record)
        return self.send(200, {"code": code, "price": price, "flight": row, "fare": fare["name"]})


reset_state()

if __name__ == "__main__":
    serve_forever([(PORT, BookingHandler, HERE / "fixture")], f"booking http://127.0.0.1:{PORT}/")
