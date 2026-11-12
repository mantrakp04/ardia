#!/usr/bin/env python3
import json
import sys
import urllib.error
import urllib.request

REVIEW = "http://127.0.0.1:8802"
DOCS = "http://127.0.0.1:8801"
CORRECT = {"vendor": "Halyard", "api_version": "v3", "team_rate_limit": "2,000", "webhook_payload_kb": "256",
           "webhook_signature": "hmac-sha256", "enterprise_audit_days": "365", "offsets_sunset": "2027-04-30",
           "notes": "", "confirm_sources": "on"}
ANSWER_STRINGS = ("2000", "2,000", "256", "365", "2027-04-30", "hmac-sha256")
failures = 0


def call(method, url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


def report(name, ok, extra=""):
    global failures
    failures += not ok
    print(f"{'PASS' if ok else 'FAIL'} {name}{' ' + extra if extra and not ok else ''}")


def run(name, overrides, want_pass):
    call("POST", f"{REVIEW}/api/reset")
    status, _ = call("POST", f"{REVIEW}/api/review", dict(CORRECT, **overrides))
    _, result = call("GET", f"{REVIEW}/api/check")
    ok = status == 201 and result["pass"] is want_pass and (result["completed_at_ms"] is not None) is want_pass
    report(name, ok, json.dumps(result["details"].get("wrong_fields")))


call("POST", f"{REVIEW}/api/reset")
_, initial = call("GET", f"{REVIEW}/api/check")
scrubbed = json.dumps({k: v for k, v in initial.items() if not k.endswith("_ms")})
report("initial check fails and leaks nothing", initial["pass"] is False and initial["total"] == 7
       and not any(a in scrubbed for a in ANSWER_STRINGS), scrubbed)

status, invalid = call("POST", f"{REVIEW}/api/review", {"vendor": "", "team_rate_limit": "lots", "confirm_sources": ""})
_, after_invalid = call("GET", f"{REVIEW}/api/check")
report("invalid submission is rejected with field errors", status == 422 and len(invalid["errors"]) == 8
       and after_invalid["details"]["rejected_submissions"] == 1 and after_invalid["pass"] is False)

run("correct answers pass", {}, True)
run("lenient formats pass", {"team_rate_limit": "2000 requests/minute", "webhook_payload_kb": "0.25 MB",
                             "enterprise_audit_days": "365 days", "offsets_sunset": "April 30, 2027", "vendor": "halyard "}, True)
run("trap: stale Team limit from the rate-limits table", {"team_rate_limit": "1,200"}, False)
run("trap: v2 Team limit", {"team_rate_limit": "600"}, False)
run("trap: v2 webhook payload size", {"webhook_payload_kb": "64"}, False)
run("trap: v2 webhook signature scheme", {"webhook_signature": "hmac-sha1"}, False)
run("trap: Business audit retention instead of Enterprise", {"enterprise_audit_days": "180"}, False)
run("trap: sunset of the POST offsets endpoint", {"offsets_sunset": "2027-01-31"}, False)

call("POST", f"{REVIEW}/api/reset")
call("POST", f"{REVIEW}/api/review", dict(CORRECT, team_rate_limit="1200"))
call("POST", f"{REVIEW}/api/review", CORRECT)
_, latest = call("GET", f"{REVIEW}/api/check")
report("latest resubmission is graded", latest["pass"] is True and latest["details"]["submissions"] == 2)

call("POST", f"{REVIEW}/api/reset")
_, cleared = call("GET", f"{REVIEW}/api/check")
report("reset clears submissions", cleared["pass"] is False and cleared["details"]["submissions"] == 0
       and cleared["details"]["rejected_submissions"] == 0)
run("second correct run passes again", {}, True)
call("POST", f"{REVIEW}/api/reset")

pages = 0
for v in ("v3", "v2"):
    with urllib.request.urlopen(f"{DOCS}/search?q=the&v={v}", timeout=10) as r:
        body = r.read().decode()
    pages += int(body.split(" results for")[0].rsplit("of ", 1)[1])
report("docs have 40+ pages", pages >= 40, str(pages))
sys.exit(1 if failures else 0)
