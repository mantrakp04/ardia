#!/usr/bin/env python3
import argparse
import base64
import html
import json
import random
import re
import sys
import threading
import time
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HOST = "127.0.0.1"
MAIL_PORT, EXPENSES_PORT, VIEWER_PORT = 8792, 8793, 8794
MAIL_ORIGIN = f"http://{HOST}:{MAIL_PORT}"
EXPENSES_ORIGIN = f"http://{HOST}:{EXPENSES_PORT}"
VIEWER_ORIGIN = f"http://{HOST}:{VIEWER_PORT}"
ME = ("Jordan Lee", "jordan@northwind.dev")
NOW = datetime(2026, 11, 6, 9, 30)
SHIFT = 13

EXPECTED = [
    {"merchant": "Delta Air Lines", "match": "delta", "date": "2026-10-03", "category": "Travel", "amount_cents": 41260},
    {"merchant": "Blue Bottle Coffee", "match": "blue bottle", "date": "2026-10-07", "category": "Meals", "amount_cents": 1840},
    {"merchant": "Figma", "match": "figma", "date": "2026-10-09", "category": "Software", "amount_cents": 4860},
    {"merchant": "Staples", "match": "staples", "date": "2026-10-14", "category": "Office", "amount_cents": 6327},
    {"merchant": "Marriott", "match": "marriott", "date": "2026-10-21", "category": "Travel", "amount_cents": 28900},
]
DRAFT_START = [
    {"id": "ln_7f3a", "merchant": "Marriott", "date": "2026-10-21", "category": "Travel", "amount_cents": 29800},
    {"id": "ln_2c91", "merchant": "Delta Air Lines", "date": "2026-10-03", "category": "Travel", "amount_cents": 41260},
]
CATEGORIES = ["Travel", "Meals", "Software", "Office", "Other"]


def shifted(text):
    return base64.b64encode(bytes((ord(c) + SHIFT) % 256 for c in text)).decode()


def strip_tags(s):
    s = re.sub(r"<(style|script)[^>]*>.*?</\1>", " ", s, flags=re.S | re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


PEOPLE = {
    "priya": ("Priya Raman", "priya@northwind.dev"),
    "marcus": ("Marcus Chen", "marcus@northwind.dev"),
    "sofia": ("Sofia Alvarez", "sofia@northwind.dev"),
    "dev": ("Dev Patel", "dev@northwind.dev"),
    "hannah": ("Hannah Okafor", "hannah@northwind.dev"),
    "lena": ("Lena Fischer", "lena@kontor.studio"),
    "mom": ("Mom", "carol.lee.1958@fastmail.com"),
    "sam": ("Sam Lee", "samlee@fastmail.com"),
}
REPOS = ["northwind/app", "northwind/web", "northwind/sync", "northwind/infra"]
PR_TITLES = ["Add retry with jitter to sync worker", "Fix flaky checkout e2e test", "Move feature flags to config service",
             "Bump React Native to 0.84", "Drop legacy auth middleware", "Cache avatar thumbnails at the edge",
             "Paginate the audit log API", "Handle 429s from the billing provider", "Rewrite onboarding stepper",
             "Add dark mode tokens", "Log slow queries over 200 ms", "Split the settings bundle"]
ISSUES = ["Onboarding checklist flickers on Safari", "Export to CSV drops the last row", "Search ignores accents",
          "Invite email links expire too early", "Sidebar collapses on resize", "Timezone wrong on recurring events",
          "Avatar upload fails over 5 MB", "Keyboard shortcuts clash with Firefox", "Billing page shows stale plan"]
CHANNELS = ["#design", "#eng-sync", "#launch-q4", "#random", "#support-escalations", "#hiring"]
FIGMA_FILES = ["Checkout v4", "Onboarding v3", "Design system 2026", "Mobile nav explorations", "Pricing page"]
NEWSLETTERS = [
    ("Frontend Focus", "frontendfocus@cooperpress.com",
     ["CSS anchor positioning is everywhere now", "A practical guide to View Transitions", "The state of web components in 2026",
      "Why your LCP is lying to you", "Popover API patterns that actually work"]),
    ("The Overflow", "newsletter@stackoverflow.email",
     ["How engineers really use AI pair programmers", "Postgres 19's new planner", "The case for boring infrastructure",
      "What we learned migrating 10M users", "On-call without burnout"]),
    ("Dense Discovery", "hello@densediscovery.com",
     ["Issue 412: Slow software", "Issue 413: Small web", "Issue 414: Calm tech", "Issue 415: Repair culture",
      "Issue 416: Quiet tools"]),
    ("Product Notes", "notes@productnotes.co",
     ["Pricing pages that convert", "Writing PRDs nobody skims", "When to kill a feature", "Activation metrics that matter",
      "Running a good design review"]),
]
THREADS = [
    ("Q4 offsite venue", ["hannah", "sofia", "priya", "marcus"],
     ["I shortlisted three places in Sonoma. Can everyone rank them by Friday?",
      "The second one has a better room for workshops, but it's a longer drive.",
      "Can we make sure there's a vegetarian option this time?",
      "Booking the second one unless someone objects by tomorrow."]),
    ("Hiring loop for senior product designer", ["marcus", "priya", "hannah"],
     ["Final candidate is on site Thursday. I need two interviewers for the portfolio review.",
      "I can take the 2 pm slot.",
      "Scorecards due by Monday please."]),
    ("Launch checklist for Sync 2.0", ["sofia", "dev", "priya"],
     ["Updated the checklist. Docs and the migration guide are still open.",
      "Migration guide is drafted, needs a review from support.",
      "Pushing launch to the 18th so we have a buffer."]),
    ("Kontor partnership", ["lena", "hannah"],
     ["Great meeting you in New York. Sharing the deck we discussed.",
      "Thanks Lena. Looping in Jordan for the integration details.",
      "Could we schedule a technical call next week?"]),
    ("Thanksgiving plans", ["mom", "sam"],
     ["Are you coming up on Wednesday or Thursday this year?",
      "I can pick up Grandma on the way.",
      "Dinner at 4. Bring the pie you made last year!"]),
]


def noise_message(rng, when, kind):
    p = PEOPLE
    if kind == "gh_pr":
        repo, title, num = rng.choice(REPOS), rng.choice(PR_TITLES), rng.randint(1100, 2400)
        who = rng.choice(["priya", "dev", "marcus"])
        return ("GitHub", "notifications@github.com", f"[{repo}] {title} (PR #{num})",
                f"<p>@{p[who][1].split('@')[0]} requested your review on: <b>{repo}#{num} {title}</b>.</p>"
                f"<p>{rng.randint(2, 14)} files changed, {rng.randint(20, 400)} additions, {rng.randint(3, 120)} deletions.</p>"
                f"<p style='color:#666'>Reply to this email directly or view it on GitHub.</p>")
    if kind == "gh_ci":
        repo, sha = rng.choice(REPOS), "%07x" % rng.getrandbits(28)
        status = rng.choice(["failed", "failed", "succeeded"])
        return ("GitHub", "notifications@github.com", f"[{repo}] Run {status}: CI - main ({sha})",
                f"<p>The workflow <b>CI</b> {status} for commit {sha} on branch main.</p>"
                f"<p>Jobs: lint ✓, unit {'✗' if status == 'failed' else '✓'}, e2e ✓. Duration {rng.randint(4, 19)}m {rng.randint(0, 59)}s.</p>")
    if kind == "gh_issue":
        repo, issue, num = rng.choice(REPOS), rng.choice(ISSUES), rng.randint(300, 900)
        who = rng.choice(["sofia", "dev", "priya"])
        return ("GitHub", "notifications@github.com", f"Re: [{repo}] {issue} (Issue #{num})",
                f"<p><b>{p[who][0]}</b> commented:</p><blockquote>I can reproduce this on the latest build. "
                f"It looks related to the change in #{num - rng.randint(1, 40)}.</blockquote>")
    if kind == "linear":
        issue, num = rng.choice(ISSUES), rng.randint(300, 700)
        state = rng.choice(["In Progress", "In Review", "Done", "Todo"])
        return ("Linear", "notifications@linear.app", f"[NW-{num}] {issue}",
                f"<p>{rng.choice([p['sofia'][0], p['priya'][0]])} moved <b>NW-{num} {issue}</b> to <b>{state}</b>.</p>")
    if kind == "slack":
        ch, n = rng.choice(CHANNELS), rng.randint(3, 40)
        return ("Slack", "feedback@slack.com", f"You have {n} unread messages in {ch}",
                f"<p>Catch up on {ch} in Northwind Labs.</p><p><b>{rng.choice(list(p.values())[:5])[0]}:</b> "
                f"{rng.choice(['shipping the fix now', 'can someone take a look at this?', 'notes from the sync are in the doc', 'lunch is here!'])}</p>")
    if kind == "invite":
        title = rng.choice(["Design review", "Sprint planning", "Roadmap sync", "1:1 Priya / Jordan", "Customer call: Acme",
                            "Incident retro", "All hands"])
        day = when + timedelta(days=rng.randint(1, 6))
        hour = rng.choice([9, 10, 11, 13, 14, 15, 16])
        return ("Google Calendar", "calendar-notification@google.com",
                f"Invitation: {title} @ {day.strftime('%a %b')} {day.day}, {hour % 12 or 12}{'am' if hour < 12 else 'pm'} (PT)",
                f"<p>You have been invited to <b>{title}</b>.</p><p>When: {day.strftime('%A %B')} {day.day}, {hour}:00 – {hour + 1}:00 (PT)</p>"
                f"<p>Join with Google Meet: meet.google.com/{rng.choice(['xqz', 'abm', 'kfp'])}-{rng.randint(1000, 9999)}</p>")
    if kind == "figma_comment":
        f = rng.choice(FIGMA_FILES)
        return ("Figma", "no-reply@figma.com", f"{p['marcus'][0]} commented on {f}",
                f"<p><b>{p['marcus'][0]}</b> left a comment in <b>{f}</b>:</p><blockquote>"
                f"{rng.choice(['Can we tighten the spacing here?', 'This matches the new tokens now.', 'What happens on an empty state?'])}</blockquote>")
    if kind == "notion":
        doc = rng.choice(["Q4 roadmap", "Sync 2.0 launch plan", "Hiring plan 2027", "Customer interview notes"])
        return ("Notion", "notify@mail.notion.so", f"{p['sofia'][0]} mentioned you in {doc}",
                f"<p>@Jordan Lee can you fill in the integration estimate in <b>{doc}</b>?</p>")
    if kind == "vercel":
        proj = rng.choice(["northwind-web", "northwind-docs", "northwind-status"])
        return ("Vercel", "notifications@vercel.com", f"Deployment ready: {proj}",
                f"<p>Your deployment of <b>{proj}</b> to Production is ready.</p><p>Build time: {rng.randint(31, 140)}s</p>")
    if kind == "sentry":
        err = rng.choice(["TypeError: Cannot read properties of undefined (reading 'id')", "ChunkLoadError: Loading chunk 482 failed",
                          "RangeError: Invalid time value", "Error: Request failed with status code 502"])
        return ("Sentry", "noreply@md.getsentry.com", f"New issue in northwind-web: {err[:48]}",
                f"<p><b>{err}</b></p><p>First seen {rng.randint(2, 50)} minutes ago, {rng.randint(3, 900)} events, {rng.randint(1, 80)} users.</p>")
    if kind == "newsletter":
        name, addr, topics = rng.choice(NEWSLETTERS)
        t = rng.choice(topics)
        return (name, addr, t,
                f"<h3>{t}</h3><p>This week: {rng.choice(['three essays', 'a long read', 'a few links'])} worth your time, "
                f"plus a tool we can't stop using.</p><p>Read online · Unsubscribe</p>")
    if kind == "drive":
        doc = rng.choice(["Board deck Q3", "Sync 2.0 pricing", "Offsite agenda", "Interview rubric"])
        return ("Google Drive", "drive-shares-dm-noreply@google.com", f"{p['hannah'][0]} shared \"{doc}\" with you",
                f"<p>{p['hannah'][0]} shared a document with you: <b>{doc}</b>.</p><p>Open in Google Docs</p>")
    if kind == "zoom":
        return ("Zoom", "no-reply@zoom.us", "Cloud recording is now available",
                f"<p>The cloud recording of <b>{rng.choice(['Customer call: Acme', 'All hands', 'Incident retro'])}</b> is ready to view.</p>")
    if kind == "security":
        return ("Northwind IT", "it@northwind.dev", "New sign-in to your Northwind account",
                f"<p>We noticed a new sign-in from Chrome on macOS near San Francisco, CA.</p><p>If this was you, you don't need to do anything.</p>")
    if kind == "uber_promo":
        return ("Uber", "uber@uber.com", rng.choice(["Your weekend plans, sorted", "Try Uber Reserve for your next airport run"]),
                "<p>Ride with Uber One and save on your next trips. Terms apply.</p>")
    if kind == "bluebottle_promo":
        return ("Blue Bottle Coffee", "hello@bluebottlecoffee.com", rng.choice(["The Holiday Blend is back", "Meet our new single origin from Kenya"]),
                "<p>Freshly roasted and shipped to your door. Visit any cafe to taste it this week.</p>")
    if kind == "recruiter":
        return (rng.choice(["Alex Morgan", "Jamie Ortiz", "Riley Brooks"]), "talent@" + rng.choice(["hirewell.io", "pinnacle-search.com"]),
                "Quick question about your team", "<p>Hi Jordan, I came across your profile and wondered if you'd be open to a quick chat about an engineering leadership role.</p>")
    if kind == "usps":
        return ("USPS Informed Delivery", "USPSInformeddelivery@email.informeddelivery.usps.com", f"Your Daily Digest for {when.strftime('%a, %m/%d')}",
                f"<p>You have {rng.randint(1, 4)} mailpieces arriving soon.</p>")
    if kind == "meetup":
        return ("SF React", "info@meetup.com", "Reminder: SF React meetup this Thursday",
                "<p>Talks: Server components in practice, and testing with the new React DevTools. Pizza at 6:30.</p>")
    raise ValueError(kind)


NOISE_KINDS = (["gh_pr"] * 5 + ["gh_ci"] * 4 + ["gh_issue"] * 3 + ["linear"] * 4 + ["slack"] * 4 + ["invite"] * 4 +
               ["figma_comment"] * 2 + ["notion"] * 2 + ["vercel"] * 2 + ["sentry"] * 2 + ["newsletter"] * 5 +
               ["drive"] + ["zoom"] + ["security"] + ["uber_promo"] + ["bluebottle_promo"] + ["recruiter"] +
               ["usps"] * 2 + ["meetup"])

DELTA_TEXT = """Thank you for choosing Delta. This is your trip receipt.

CONFIRMATION NUMBER: HZQ7LM
BOOKING DATE: 03OCT26
PASSENGER: JORDAN LEE   SKYMILES #9134 228 401

FLIGHT 1  DL 1123  MON 19OCT  SFO 07:05A -> JFK 03:40P   MAIN CABIN (V)
FLIGHT 2  DL 2290  WED 21OCT  JFK 06:15P -> SFO 09:52P   MAIN CABIN (V)

FARE                         USD 356.28
TAXES, FEES AND CHARGES      USD  56.32
TICKET TOTAL                 USD 412.60

FORM OF PAYMENT: VISA ************4421   AMOUNT: USD 412.60
TICKET NUMBER: 0062 4418 90217

Your trip is non-refundable. Changes are allowed for a fare difference.
Manage your trip at delta.com/mytrips.
"""

BLUE_BOTTLE_HTML = """<div style="font-family:Georgia,serif;max-width:460px">
<p style="font-size:18px;margin:0 0 4px">Thanks for stopping by.</p>
<p style="color:#555;margin:0 0 16px">Blue Bottle Coffee · Hayes Valley · 315 Linden St, San Francisco</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">
<thead><tr><th style="text-align:left;border-bottom:1px solid #ccc;padding:4px 0">Item</th><th style="text-align:right;border-bottom:1px solid #ccc;padding:4px 0">Qty</th><th style="text-align:right;border-bottom:1px solid #ccc;padding:4px 0">Price</th></tr></thead>
<tbody>
<tr><td style="padding:4px 0">Oat milk latte</td><td style="text-align:right">1</td><td style="text-align:right">5.75</td></tr>
<tr><td style="padding:4px 0">Cortado</td><td style="text-align:right">1</td><td style="text-align:right">5.25</td></tr>
<tr><td style="padding:4px 0">Morning bun</td><td style="text-align:right">1</td><td style="text-align:right">5.75</td></tr>
<tr><td style="padding:4px 0;border-top:1px solid #eee">Subtotal</td><td></td><td style="text-align:right;border-top:1px solid #eee">16.75</td></tr>
<tr><td style="padding:4px 0">Sales tax (9.875%)</td><td></td><td style="text-align:right">1.65</td></tr>
<tr><td style="padding:6px 0;font-weight:bold;border-top:2px solid #333">Total</td><td style="border-top:2px solid #333"></td><td style="text-align:right;font-weight:bold;border-top:2px solid #333">$18.40</td></tr>
</tbody></table>
<p style="color:#555;font-size:13px;margin-top:16px">Visa ending 4421 · Order #BB-20261007-0318 · Wednesday, October 7, 2026, 8:51 AM</p>
</div>"""

FIGMA_HTML = """<div style="font-family:Helvetica,Arial,sans-serif;max-width:520px">
<h2 style="font-weight:600;margin:0 0 8px">Payment confirmation</h2>
<p>We've received your payment for Figma Professional. Thanks for being a customer.</p>
<table style="font-size:14px;border-collapse:collapse">
<tr><td style="padding:3px 16px 3px 0;color:#666">Invoice</td><td>FIG-2026-0094417</td></tr>
<tr><td style="padding:3px 16px 3px 0;color:#666">Date paid</td><td>9 October 2026</td></tr>
<tr><td style="padding:3px 16px 3px 0;color:#666">Plan</td><td>Professional · 1 editor · monthly</td></tr>
<tr><td style="padding:3px 16px 3px 0;color:#666">Billing entity</td><td>Figma Ireland Ltd., Dublin</td></tr>
<tr><td style="padding:3px 16px 3px 0;color:#666">Subtotal</td><td>€45,00</td></tr>
<tr><td style="padding:3px 16px 3px 0;color:#666">VAT</td><td>€0,00 (reverse charge)</td></tr>
<tr><td style="padding:3px 16px 3px 0;font-weight:bold">Amount paid</td><td style="font-weight:bold">€45,00 EUR</td></tr>
<tr><td style="padding:3px 16px 3px 0;color:#666">Payment method</td><td>Visa •••• 4421</td></tr>
</table>
<p style="color:#666;font-size:13px">Your card may show a different amount depending on your bank's exchange rate.</p>
</div>"""

STAPLES_LINES = [
    "^*STAPLES",
    "^Store 0871 · Market St",
    "^San Francisco, CA 94103",
    "^(415) 555-0142",
    "-",
    "10/14/2026 3:42 PM|Trn 6612",
    "-",
    "Copy paper 8.5x11 500ct|",
    "  2 @ 14.99|29.98",
    "HP 952 ink, black|27.49",
    "-",
    "SUBTOTAL|57.47",
    "SALES TAX 10.09%|5.80",
    "*TOTAL|$63.27",
    "-",
    "VISA ************4421|63.27",
    "AUTH 038812",
    "-",
    "^Thank you for shopping at Staples",
    "^Returns within 14 days with receipt",
]

GITHUB_HTML = """<div style="font-family:-apple-system,Helvetica,sans-serif;max-width:520px">
<h3 style="margin:0 0 8px">Thanks for your payment</h3>
<p>We received payment for your GitHub account <b>jordanlee</b>.</p>
<table style="font-size:14px">
<tr><td style="padding:2px 14px 2px 0;color:#57606a">Billing date</td><td>September 30, 2026</td></tr>
<tr><td style="padding:2px 14px 2px 0;color:#57606a">Plan</td><td>GitHub Team · 3 seats × $7.00</td></tr>
<tr><td style="padding:2px 14px 2px 0;color:#57606a">Total</td><td><b>$21.00 USD</b></td></tr>
<tr><td style="padding:2px 14px 2px 0;color:#57606a">Charged to</td><td>Visa ending in 4421</td></tr>
<tr><td style="padding:2px 14px 2px 0;color:#57606a">Transaction ID</td><td>ch_3QpX09GH21</td></tr>
</table>
<p style="color:#57606a;font-size:13px">Your next billing date is October 30, 2026.</p>
</div>"""

UBER_HTML = """<div style="font-family:Helvetica,Arial,sans-serif;max-width:480px">
<p style="font-size:22px;font-weight:bold;margin:0">Total $31.75</p>
<p style="color:#666;margin:2px 0 14px">October 24, 2026 · Thanks for riding, Jordan</p>
<table style="width:100%;font-size:14px">
<tr><td>Trip fare</td><td style="text-align:right">$24.10</td></tr>
<tr><td>Booking fee</td><td style="text-align:right">$3.15</td></tr>
<tr><td>Tip</td><td style="text-align:right">$4.50</td></tr>
<tr><td style="font-weight:bold;border-top:1px solid #ddd">Total</td><td style="text-align:right;font-weight:bold;border-top:1px solid #ddd">$31.75</td></tr>
</table>
<p style="font-size:13px;color:#666">UberX · 7:58 PM 1455 Market St → 8:24 PM 2900 Fillmore St · 4.81 mi · Visa ••••4421</p>
</div>"""

UBER_REFUND_HTML = """<div style="font-family:Helvetica,Arial,sans-serif;max-width:480px">
<p>Hi Jordan,</p>
<p>We're sorry about your trip on October 24. Your driver took a significantly longer route than expected.</p>
<p>We've issued a full refund of <b>$31.75</b> to your Visa ••••4421. It can take 5–10 business days to appear on your statement.</p>
<p>— Uber Support</p>
</div>"""

STAPLES_NEWSLETTER = """<div style="font-family:Arial,sans-serif;max-width:560px">
<h2 style="color:#c00;margin:0">October at Staples</h2>
<p>Back-to-office season is here. Stock up and save.</p>
<table style="width:100%;font-size:14px">
<tr><td>Copy paper 8.5x11, 500 sheets</td><td style="text-align:right"><s>$17.99</s> <b>$14.99</b></td></tr>
<tr><td>HP 952 ink cartridges</td><td style="text-align:right">from <b>$27.49</b></td></tr>
<tr><td>Ergonomic mesh chair</td><td style="text-align:right"><b>$189.00</b></td></tr>
<tr><td>Sticky notes, 24 pack</td><td style="text-align:right"><b>$12.79</b></td></tr>
</table>
<p style="font-size:12px;color:#777">Prices valid Oct 1–31, 2026 while supplies last. You're receiving our October newsletter because you joined Staples Rewards.</p>
</div>"""

FINANCE_SEPT = """<p>Hi all,</p>
<p>For September expense reports, please convert foreign-currency purchases at these rates:</p>
<ul><li>1 EUR = 1.11 USD</li><li>1 GBP = 1.30 USD</li></ul>
<p>Reports are due October 10.</p><p>Thanks,<br>Finance</p>"""

FINANCE_OCT = """<p>Hi everyone,</p>
<p>Quick note for the October close. Use these conversion rates for any purchase made in a foreign currency in October 2026, whatever your card statement says:</p>
<ul><li>1 EUR = 1.08 USD</li><li>1 GBP = 1.27 USD</li><li>1 CAD = 0.73 USD</li></ul>
<p>Round the converted amount to the cent. October reports are due November 10.</p>
<p>Thanks,<br>Finance</p>"""

MARRIOTT_PRESTAY = """<p>Dear Jordan,</p>
<p>We look forward to welcoming you to the New York Marriott Marquis on Tuesday, October 20. Check-in begins at 4:00 PM.</p>
<p>Your reservation: 1 night, King room, rate USD 249.00 per night before taxes. Confirmation 88231904.</p>
<p>Add a late checkout or upgrade in the Marriott Bonvoy app.</p>"""

FOLIO_HTML = """<!doctype html><html><head><meta charset="utf-8"><title>Folio 88231904</title>
<style>
body{margin:0;background:#525659;font:13px/1.45 "Helvetica Neue",Arial,sans-serif;color:#222}
.page{background:#fff;width:560px;margin:16px auto;padding:36px 40px;box-shadow:0 2px 8px rgba(0,0,0,.4)}
h1{font:600 18px Georgia,serif;margin:0}
.addr{color:#666;margin-bottom:18px}
.grid{display:grid;grid-template-columns:auto 1fr auto 1fr;gap:2px 14px;margin-bottom:18px}
.grid span:nth-child(odd){color:#666}
table{width:100%;border-collapse:collapse}
th{text-align:left;border-bottom:1px solid #999;padding:4px 0;font-weight:600}
td{padding:4px 0;border-bottom:1px solid #eee}
td.n,th.n{text-align:right}
tr.total td{font-weight:700;border-top:2px solid #333;border-bottom:none}
.foot{margin-top:22px;color:#777;font-size:11px}
</style></head><body><div class="page">
<h1>New York Marriott Marquis</h1>
<div class="addr">1535 Broadway, New York, NY 10036 · +1 212-398-1900</div>
<div class="grid">
<span>Guest</span><span>Jordan Lee</span><span>Folio</span><span>88231904</span>
<span>Arrival</span><span>10/20/26</span><span>Room</span><span>3112 King</span>
<span>Departure</span><span>10/21/26</span><span>Bonvoy</span><span>XXXXX2207</span>
</div>
<table><thead><tr><th>Date</th><th>Description</th><th class="n">Charges</th><th class="n">Credits</th></tr></thead>
<tbody>
<tr><td>10/20/26</td><td>Room charge, King</td><td class="n">249.00</td><td class="n"></td></tr>
<tr><td>10/20/26</td><td>NY State &amp; City occupancy tax</td><td class="n">36.09</td><td class="n"></td></tr>
<tr><td>10/20/26</td><td>NYC hotel unit fee</td><td class="n">3.91</td><td class="n"></td></tr>
<tr><td>10/21/26</td><td>Visa ****4421 payment</td><td class="n"></td><td class="n">289.00</td></tr>
<tr class="total"><td></td><td>Total charges</td><td class="n">289.00</td><td class="n"></td></tr>
<tr class="total"><td></td><td>Balance due</td><td class="n">0.00</td><td class="n"></td></tr>
</tbody></table>
<div class="foot">Charged to Visa ****4421 on 10/21/26 at check-out. Thank you for staying with Marriott Bonvoy.</div>
</div></body></html>"""

REMINDER_HTML = f"""<p>Hi Jordan,</p>
<p>Your <b>October 2026</b> expense report is still a draft. It's due <b>November 10</b>.</p>
<p>Add every October purchase with its receipt, then submit: <a href="{EXPENSES_ORIGIN}/">{EXPENSES_ORIGIN}/</a></p>
<p>— Northwind Expenses</p>"""


def special_messages():
    d = lambda s: datetime.strptime(s, "%Y-%m-%d %H:%M")
    fin = ("Finance", "finance@northwind.dev")
    return [
        dict(when=d("2026-09-02 10:12"), sender=fin, subject="September expenses: FX rates", html=FINANCE_SEPT),
        dict(when=d("2026-09-14 16:40"), sender=("Northwind Expenses", "expenses@northwind.dev"),
             subject="Your August expense report was approved", html="<p>Your August 2026 report (4 lines, $388.14) was approved by Hannah Okafor and will be reimbursed on your next paycheck.</p>"),
        dict(when=d("2026-10-01 00:14"), sender=("GitHub", "billing@github.com"), subject="[GitHub] Payment receipt for jordanlee", html=GITHUB_HTML),
        dict(when=d("2026-10-01 09:05"), sender=fin, subject="October close: conversion rates", html=FINANCE_OCT),
        dict(when=d("2026-10-02 07:30"), sender=("Staples", "staples@e.staples.com"), subject="Our October newsletter: back-to-office savings", html=STAPLES_NEWSLETTER),
        dict(when=d("2026-10-03 21:18"), sender=("Delta Air Lines", "DeltaAirLines@t.delta.com"), subject="Your trip confirmation: SFO to New York", text=DELTA_TEXT),
        dict(when=d("2026-10-07 08:52"), sender=("Blue Bottle Coffee", "receipts@bluebottlecoffee.com"), subject="Your purchase at Blue Bottle Coffee", html=BLUE_BOTTLE_HTML),
        dict(when=d("2026-10-09 06:03"), sender=("Figma", "billing@figma.com"), subject="Payment confirmation for Figma Professional", html=FIGMA_HTML),
        dict(when=d("2026-10-14 15:44"), sender=("Staples", "receipts@staples.com"), subject="Thanks for shopping with us",
             html="<p>Thanks for shopping at Staples Market St. Here's a copy of your receipt.</p><p>Keep it for returns and exchanges within 14 days.</p>",
             attachments=[{"name": "receipt-0871-6612.png", "kind": "scan", "width": 360, "data": shifted("\n".join(STAPLES_LINES))}]),
        dict(when=d("2026-10-18 10:00"), sender=("Delta Air Lines", "DeltaAirLines@t.delta.com"), subject="It's time to check in for your flight to New York",
             html="<p>Check in now for DL 1123 SFO → JFK on Monday, October 19 at 7:05 AM. Confirmation HZQ7LM.</p>"),
        dict(when=d("2026-10-18 12:30"), sender=("Marriott Bonvoy", "marriott@email-marriott.com"), subject="Your stay at New York Marriott Marquis is coming up", html=MARRIOTT_PRESTAY),
        dict(when=d("2026-10-21 11:47"), sender=("New York Marriott Marquis", "folio@marriott.com"), subject="Folio for your stay, Oct 20–21",
             html="<p>Dear Jordan Lee,</p><p>Thank you for staying with us. A copy of your folio is attached for your records.</p><p>We hope to welcome you back soon.</p>",
             attachments=[{"name": "Folio-88231904.pdf", "kind": "viewer", "src": f"{VIEWER_ORIGIN}/view/folio-88231904"}]),
        dict(when=d("2026-10-24 20:31"), sender=("Uber Receipts", "noreply@uber.com"), subject="Your Saturday evening trip with Uber", html=UBER_HTML),
        dict(when=d("2026-10-26 14:09"), sender=("Uber Support", "support@uber.com"), subject="Refund issued for your Oct 24 trip", html=UBER_REFUND_HTML),
        dict(when=d("2026-11-02 09:00"), sender=("Northwind Expenses", "expenses@northwind.dev"), subject="Reminder: your October expense report is due Nov 10", html=REMINDER_HTML),
    ]


def build_mailbox():
    rng = random.Random(20261106)
    msgs = []
    day = datetime(2026, 9, 1)
    thread_slots = []
    for t_i, (subject, who, lines) in enumerate(THREADS):
        start = datetime(2026, 9, 6) + timedelta(days=11 * t_i + rng.randint(0, 5))
        for k, (person, line) in enumerate(zip(who * 2, lines)):
            thread_slots.append((start + timedelta(days=k, hours=rng.randint(8, 18), minutes=rng.randint(0, 59)),
                                 PEOPLE[person], ("Re: " if k else "") + subject, f"<p>{line}</p><p>{PEOPLE[person][0].split()[0]}</p>"))
    for when, sender, subject, body in thread_slots:
        msgs.append(dict(when=when, sender=sender, subject=subject, html=body))
    while day <= datetime(2026, 11, 5):
        for _ in range(rng.choice([2, 2, 3, 3, 3])):
            when = day + timedelta(hours=rng.randint(6, 22), minutes=rng.randint(0, 59))
            name, email, subject, body = noise_message(rng, when, rng.choice(NOISE_KINDS))
            msgs.append(dict(when=when, sender=(name, email), subject=subject, html=body))
        day += timedelta(days=1)
    target = 200 - len(special_messages())
    rng.shuffle(msgs)
    msgs = msgs[:target] + special_messages()
    msgs.sort(key=lambda m: m["when"], reverse=True)
    out = []
    for i, m in enumerate(msgs):
        mid = "%012x" % rng.getrandbits(48)
        body_text = m.get("text") or strip_tags(m.get("html", ""))
        out.append({
            "id": mid,
            "from": {"name": m["sender"][0], "email": m["sender"][1]},
            "to": {"name": ME[0], "email": ME[1]},
            "subject": m["subject"],
            "date": m["when"].strftime("%Y-%m-%dT%H:%M:00"),
            "body": {"type": "text", "content": m["text"]} if "text" in m else {"type": "html", "content": m["html"]},
            "attachments": m.get("attachments", []),
            "snippet": body_text[:140],
            "search": " ".join([m["subject"], m["sender"][0], m["sender"][1], body_text]).lower(),
            "initially_unread": m["when"] > datetime(2026, 10, 29) and rng.random() < 0.7 or m["when"] > datetime(2026, 11, 4),
        })
    return out


MAILBOX = build_mailbox()
MAIL_BY_ID = {m["id"]: m for m in MAILBOX}


class State:
    def __init__(self):
        self.lock = threading.Lock()
        self.reset()

    def reset(self):
        self.lines = [dict(l) for l in DRAFT_START]
        self.read = {m["id"] for m in MAILBOX if not m["initially_unread"]}
        self.submissions = []
        self.rejected_submits = []
        self.counts = {"line_adds": 0, "line_edits": 0, "line_saves": 0, "line_deletes": 0, "reorders": 0}
        self.reset_at = time.time()
        self.next_id = 0

    def new_id(self):
        self.next_id += 1
        return "ln_%04x" % (0xa100 + self.next_id * 37)


STATE = State()


def norm_merchant(s):
    return re.sub(r"[^a-z0-9]+", " ", str(s).lower()).strip()


def cents_of(line):
    c = line.get("amount_cents")
    if isinstance(c, int) and not isinstance(c, bool):
        return c
    try:
        return round(float(str(line.get("amount", "")).replace("$", "").replace(",", "")) * 100)
    except ValueError:
        return None


def check():
    with STATE.lock:
        subs = list(STATE.submissions)
        rejected = list(STATE.rejected_submits)
        counts = dict(STATE.counts)
        reset_at = STATE.reset_at
    mismatches = []
    submitted = subs[0]["lines"] if subs else []
    if not subs:
        return {"pass": False, "matched": 0, "total": len(EXPECTED), "extra": 0, "completed_at_ms": None,
                "reset_at_ms": round(reset_at * 1000),
                "details": {"mismatches": [{"type": "no_submission"}], "submissions": 0, "rejected_submits": len(rejected),
                            "submitted_lines": [], "submitted_at_ms": None, "submitted_ms_after_reset": None, "counts": counts}}
    if len(subs) > 1:
        mismatches.append({"type": "multiple_submissions", "count": len(subs)})
    claimed = set()
    matched = 0
    for i, e in enumerate(EXPECTED):
        j = next((k for k, l in enumerate(submitted) if k not in claimed and e["match"] in norm_merchant(l.get("merchant", ""))), None)
        if j is None:
            mismatches.append({"type": "missing", "merchant": e["merchant"], "expected_position": i + 1})
            continue
        claimed.add(j)
        line = submitted[j]
        ok = True
        for field, want, got in (("date", e["date"], str(line.get("date", "")).strip()),
                                 ("category", e["category"], str(line.get("category", "")).strip()),
                                 ("amount_cents", e["amount_cents"], cents_of(line))):
            if (got.lower() if field == "category" else got) != (want.lower() if field == "category" else want):
                ok = False
                mismatches.append({"type": "wrong_field", "merchant": e["merchant"], "field": field, "got": got})
        if j != i:
            ok = False
            mismatches.append({"type": "wrong_order", "merchant": e["merchant"], "expected_position": i + 1, "got_position": j + 1})
        matched += ok
    extra = [dict(l, position=k + 1) for k, l in enumerate(submitted) if k not in claimed]
    for x in extra:
        mismatches.append({"type": "extra", "line": x})
    passed = len(subs) == 1 and not mismatches and len(submitted) == len(EXPECTED)
    sub = subs[0] if subs else None
    return {
        "pass": passed,
        "matched": matched,
        "total": len(EXPECTED),
        "extra": len(extra),
        "completed_at_ms": sub["at_ms"] if passed else None,
        "reset_at_ms": round(reset_at * 1000),
        "details": {
            "mismatches": mismatches,
            "submissions": len(subs),
            "rejected_submits": len(rejected),
            "submitted_lines": submitted,
            "submitted_at_ms": sub["at_ms"] if sub else None,
            "submitted_ms_after_reset": round(sub["at_ms"] - reset_at * 1000) if sub else None,
            "counts": counts,
        },
    }


def valid_line(d):
    if not isinstance(d, dict):
        return None
    merchant = str(d.get("merchant", "")).strip()
    date = str(d.get("date", "")).strip()
    category = str(d.get("category", "")).strip()
    cents = d.get("amount_cents")
    if not merchant or len(merchant) > 120 or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date) or category not in CATEGORIES:
        return None
    if not isinstance(cents, int) or isinstance(cents, bool) or cents <= 0 or cents > 10_000_000:
        return None
    return {"merchant": merchant, "date": date, "category": category, "amount_cents": cents}


class Base(BaseHTTPRequestHandler):
    server_version = "hardserver/1"
    root = None

    def log_message(self, fmt, *args):
        if self.server.verbose:
            sys.stderr.write(f"[{self.server.server_port}] {fmt % args}\n")

    def send(self, code, body, ctype="application/json", headers=None):
        data = body if isinstance(body, bytes) else (json.dumps(body).encode() if ctype == "application/json" else body.encode())
        self.send_response(code)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if ctype.startswith(("text/", "application/j")) else ""))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def body_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 1_000_000:
            return None
        try:
            return json.loads(self.rfile.read(n) or b"null")
        except ValueError:
            return None

    def static(self, path):
        types = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png"}
        rel = "index.html" if path in ("", "/") else path.lstrip("/")
        target = (self.root / rel).resolve()
        if self.root.resolve() not in target.parents or not target.is_file() or target.suffix not in types:
            return self.send(404, {"error": "not found"})
        self.send(200, target.read_bytes(), types[target.suffix])

    def do_HEAD(self):
        self.do_GET()


class MailHandler(Base):
    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/api/messages":
            q = parse_qs(u.query)
            terms = (q.get("q", [""])[0]).lower().split()
            try:
                offset = max(0, int(q.get("offset", ["0"])[0]))
                limit = min(100, max(1, int(q.get("limit", ["40"])[0])))
            except ValueError:
                return self.send(400, {"error": "bad paging"})
            hits = [m for m in MAILBOX if all(t in m["search"] for t in terms)]
            with STATE.lock:
                read = set(STATE.read)
            page = [{"id": m["id"], "from": m["from"], "subject": m["subject"], "snippet": m["snippet"], "date": m["date"],
                     "unread": m["id"] not in read, "has_attachment": bool(m["attachments"])} for m in hits[offset:offset + limit]]
            time.sleep(0.12)
            return self.send(200, {"total": len(hits), "offset": offset, "messages": page})
        m = re.fullmatch(r"/api/messages/([0-9a-f]{12})", u.path)
        if m:
            msg = MAIL_BY_ID.get(m.group(1))
            if not msg:
                return self.send(404, {"error": "no such message"})
            time.sleep(0.08)
            return self.send(200, {k: v for k, v in msg.items() if k not in ("search", "initially_unread")})
        return self.static(u.path)

    def do_POST(self):
        m = re.fullmatch(r"/api/messages/([0-9a-f]{12})/read", urlparse(self.path).path)
        if m and m.group(1) in MAIL_BY_ID:
            with STATE.lock:
                STATE.read.add(m.group(1))
            return self.send(200, {"ok": True})
        self.send(404, {"error": "not found"})


class ExpensesHandler(Base):
    def report(self):
        with STATE.lock:
            sub = STATE.submissions[0] if STATE.submissions else None
            return {"id": "rpt_2026_10", "title": "October 2026", "employee": ME[0],
                    "status": "submitted" if sub else "draft", "reference": sub["reference"] if sub else None,
                    "lines": [dict(l) for l in STATE.lines], "categories": CATEGORIES, "today": NOW.strftime("%Y-%m-%d")}

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/api/report":
            return self.send(200, self.report())
        if u.path == "/api/check":
            return self.send(200, check())
        return self.static(u.path)

    def locked_draft(self):
        if STATE.submissions:
            self.send(409, {"error": "This report was already submitted."})
            return True
        return False

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/reset":
            with STATE.lock:
                STATE.reset()
            return self.send(200, {"ok": True})
        body = self.body_json()
        if path == "/api/lines":
            line = valid_line(body)
            if not line:
                return self.send(422, {"error": "Invalid line"})
            with STATE.lock:
                if self.locked_draft():
                    return
                line["id"] = STATE.new_id()
                STATE.lines.append(line)
                STATE.counts["line_adds"] += 1
                STATE.counts["line_saves"] += 1
            return self.send(201, line)
        if path == "/api/lines/order":
            ids = body.get("ids") if isinstance(body, dict) else None
            with STATE.lock:
                if self.locked_draft():
                    return
                current = [l["id"] for l in STATE.lines]
                if not isinstance(ids, list) or sorted(ids) != sorted(current):
                    return self.send(409, {"error": "Lines changed, reload the report"})
                by_id = {l["id"]: l for l in STATE.lines}
                STATE.lines = [by_id[i] for i in ids]
                STATE.counts["reorders"] += 1
            return self.send(200, {"ok": True})
        if path == "/api/submit":
            lines = body.get("lines") if isinstance(body, dict) else None
            at_ms = round(time.time() * 1000)
            with STATE.lock:
                if STATE.submissions:
                    STATE.rejected_submits.append({"at_ms": at_ms})
                    return self.send(409, {"error": "This report was already submitted."})
                if not isinstance(lines, list) or not lines or len(lines) > 100:
                    STATE.rejected_submits.append({"at_ms": at_ms, "reason": "no lines"})
                    return self.send(422, {"error": "Add at least one line before submitting."})
                clean = []
                for l in lines:
                    v = valid_line(l)
                    if not v:
                        STATE.rejected_submits.append({"at_ms": at_ms, "reason": "invalid line"})
                        return self.send(422, {"error": "A line is incomplete."})
                    v["amount"] = "%d.%02d" % divmod(v["amount_cents"], 100)
                    clean.append(v)
                ref = "EXP-2026-10-%04d" % (4400 + len(clean) * 3)
                STATE.submissions.append({"at_ms": at_ms, "lines": clean, "reference": ref})
            return self.send(200, {"ok": True, "reference": ref})
        self.send(404, {"error": "not found"})

    def do_PUT(self):
        m = re.fullmatch(r"/api/lines/(ln_[0-9a-z]+)", urlparse(self.path).path)
        line = valid_line(self.body_json())
        if not m:
            return self.send(404, {"error": "not found"})
        if not line:
            return self.send(422, {"error": "Invalid line"})
        with STATE.lock:
            if self.locked_draft():
                return
            for l in STATE.lines:
                if l["id"] == m.group(1):
                    l.update(line)
                    STATE.counts["line_edits"] += 1
                    STATE.counts["line_saves"] += 1
                    return self.send(200, dict(l))
        self.send(404, {"error": "no such line"})

    def do_DELETE(self):
        m = re.fullmatch(r"/api/lines/(ln_[0-9a-z]+)", urlparse(self.path).path)
        with STATE.lock:
            if self.locked_draft():
                return
            before = len(STATE.lines)
            STATE.lines = [l for l in STATE.lines if not m or l["id"] != m.group(1)]
            if len(STATE.lines) == before:
                return self.send(404, {"error": "no such line"})
            STATE.counts["line_deletes"] += 1
        self.send(200, {"ok": True})


class ViewerHandler(Base):
    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/view/folio-88231904":
            return self.send(200, FOLIO_HTML, "text/html",
                             {"Content-Security-Policy": f"frame-ancestors {MAIL_ORIGIN}", "Cross-Origin-Resource-Policy": "same-site"})
        self.send(404, "not found", "text/plain")


def serve(port, handler, root, verbose):
    cls = type(handler.__name__, (handler,), {"root": root})
    srv = ThreadingHTTPServer((HOST, port), cls)
    srv.daemon_threads = True
    srv.verbose = verbose
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main():
    ap = argparse.ArgumentParser(description="Hard browser-agent benchmark: Mail on 8792, Expenses on 8793 "
                                             "(POST /api/reset, GET /api/check), receipt viewer on 8794.")
    ap.add_argument("--fixture", default=str(Path(__file__).resolve().parent / "fixture"))
    ap.add_argument("--verbose", action="store_true")
    a = ap.parse_args()
    fx = Path(a.fixture)
    servers = [serve(MAIL_PORT, MailHandler, fx / "mail", a.verbose),
               serve(EXPENSES_PORT, ExpensesHandler, fx / "expenses", a.verbose),
               serve(VIEWER_PORT, ViewerHandler, fx / "viewer", a.verbose)]
    print(f"mail {MAIL_ORIGIN}/  expenses {EXPENSES_ORIGIN}/  viewer {VIEWER_ORIGIN}/  ({len(MAILBOX)} emails)", flush=True)
    stop = threading.Event()
    try:
        import signal
        signal.signal(signal.SIGTERM, lambda *_: stop.set())
        while not stop.wait(1):
            pass
    except KeyboardInterrupt:
        pass
    for s in servers:
        s.shutdown()


if __name__ == "__main__":
    main()
